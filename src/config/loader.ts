import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { LocksConfigSchema, type LocksConfig } from "./schema.js";

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
  const raw = await readFile(path, "utf8");
  const warnings: string[] = [];

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
