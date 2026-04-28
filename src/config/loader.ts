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

function checkUniqueness(config: LocksConfig): void {
  const ids = new Set<string>();
  const nodes = new Set<number>();
  for (const lock of config.locks) {
    if (ids.has(lock.id)) throw new Error(`Duplicate lock id: ${lock.id}`);
    if (nodes.has(lock.nodeId)) throw new Error(`Duplicate nodeId: ${lock.nodeId}`);
    ids.add(lock.id);
    nodes.add(lock.nodeId);
  }
}

export async function loadLocksConfig(path: string, opts: LoadOptions = {}): Promise<LoadedConfig> {
  const env = opts.env ?? process.env;
  const inAddonMode = !!env.SUPERVISOR_TOKEN;
  const raw = await readFile(path, "utf8");
  const warnings: string[] = [];

  if (inAddonMode) {
    const parsedJson = JSON.parse(raw);
    const result = AddonOptionsSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new Error(`Invalid addon options: ${result.error.message}`);
    }
    const o = result.data;
    const shaped: LocksConfig = {
      zwaveJs: { url: "" }, // discovered at runtime
      homeAssistant: {
        url: "http://supervisor/core",
        token: env.SUPERVISOR_TOKEN ?? "",
        notify: { service: o.notify_service },
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
    // Re-validate against the same schema we use for YAML mode so any drift
    // between the two paths fails loudly.
    const re = LocksConfigSchema.safeParse(shaped);
    if (!re.success) {
      throw new Error(`addon config shape mismatch: ${re.error.message}`);
    }
    checkUniqueness(re.data);
    return { ...re.data, warnings };
  }

  const parsed = parseYaml(raw);
  const interpolated = interpolateValue(parsed, env, warnings);

  const result = LocksConfigSchema.safeParse(interpolated);
  if (!result.success) {
    throw new Error(`Invalid locks config: ${result.error.message}`);
  }
  const config = result.data;

  checkUniqueness(config);

  return { ...config, warnings };
}
