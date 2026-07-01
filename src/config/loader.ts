import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { LocksConfigSchema, type LocksConfig } from "./schema.js";
import { AddonOptionsSchema } from "./options-schema.js";

export interface LoadedConfig extends LocksConfig {
  warnings: string[];
}

export interface LoadOptions {
  env?: Record<string, string | undefined>;
}

const ENV_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function interpolateValue(
  value: unknown,
  env: Record<string, string | undefined>,
  warnings: string[],
): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_PATTERN, (_match, name: string) => {
      const v = env[name];
      if (v === undefined) {
        warnings.push(`Unresolved env var: ${name}`);
        return "";
      }
      return v;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, env, warnings));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateValue(v, env, warnings);
    }
    return result;
  }
  return value;
}

export async function loadLocksConfig(path: string, opts: LoadOptions = {}): Promise<LoadedConfig> {
  const env = opts.env ?? process.env;
  const inAddonMode = !!env.SUPERVISOR_TOKEN;
  const raw = await readFile(path, "utf8");
  const warnings: string[] = [];

  if (inAddonMode) {
    return loadAddonConfig(raw, env, warnings);
  }

  const parsed = parseYaml(raw);
  const interpolated = interpolateValue(parsed, env, warnings);

  const result = LocksConfigSchema.safeParse(interpolated);
  if (!result.success) {
    throw new Error(`Invalid locks config: ${result.error.message}`);
  }
  const config = result.data;

  const ids = new Set<string>();
  const nodes = new Set<number>();
  for (const lock of config.locks) {
    if (ids.has(lock.id)) throw new Error(`Duplicate lock id: ${lock.id}`);
    if (nodes.has(lock.nodeId)) throw new Error(`Duplicate nodeId: ${lock.nodeId}`);
    ids.add(lock.id);
    nodes.add(lock.nodeId);
  }

  return { ...config, warnings };
}

/**
 * Addon-mode loader: shape HA's `/data/options.json` into the same `LocksConfig`
 * we use in standalone mode. The Z-Wave URL is left empty here and resolved at
 * runtime via the Supervisor discovery API (see config/discovery.ts).
 */
function loadAddonConfig(
  raw: string,
  env: Record<string, string | undefined>,
  warnings: string[],
): LoadedConfig {
  const parsedJson: unknown = JSON.parse(raw);
  const result = AddonOptionsSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(`Invalid addon options: ${result.error.message}`);
  }
  const o = result.data;

  // An explicit zwave_url skips discovery; a blank value keeps the empty-string
  // sentinel so app startup discovers the HA Z-Wave JS add-on instead.
  const zwaveUrl = o.zwave_url?.trim() ? o.zwave_url.trim() : "";

  const config: LocksConfig = {
    zwaveJs: { url: zwaveUrl }, // empty => discovered at runtime from the Supervisor
    homeAssistant: {
      url: "http://supervisor/core",
      token: env.SUPERVISOR_TOKEN ?? "",
      notify: {
        service: o.notify_service,
        ...(o.notify_category ? { category: o.notify_category } : {}),
      },
    },
    verify: {
      intervalDays: o.verify_interval_days,
      staggerMinutes: o.verify_stagger_minutes,
    },
    readOnly: o.read_only,
    locks: o.locks.map((l) => ({
      id: l.id,
      name: l.name,
      nodeId: l.node_id,
      maxCodeSlots: l.max_code_slots,
    })),
  };

  // Re-validate the shaped object against the same schema YAML mode uses, so any
  // drift between the two config paths fails loudly here rather than at runtime.
  const re = LocksConfigSchema.safeParse(config);
  if (!re.success) {
    throw new Error(`addon config shape mismatch: ${re.error.message}`);
  }

  const ids = new Set<string>();
  const nodes = new Set<number>();
  for (const lock of config.locks) {
    if (ids.has(lock.id)) throw new Error(`Duplicate lock id: ${lock.id}`);
    if (nodes.has(lock.nodeId)) throw new Error(`Duplicate nodeId: ${lock.nodeId}`);
    ids.add(lock.id);
    nodes.add(lock.nodeId);
  }

  return { ...config, warnings };
}
