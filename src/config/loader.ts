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

export async function loadLocksConfig(path: string, opts: LoadOptions = {}): Promise<LoadedConfig> {
  const env = opts.env ?? process.env;
  const raw = await readFile(path, "utf8");
  const warnings: string[] = [];
  const interpolated = raw.replace(ENV_PATTERN, (_match, name: string) => {
    const v = env[name];
    if (v === undefined) {
      warnings.push(`Unresolved env var: ${name}`);
      // Return a YAML-quoted empty string so the field parses as "" not null
      return '""';
    }
    return v;
  });

  const parsed = parseYaml(interpolated);
  const result = LocksConfigSchema.safeParse(parsed);
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
