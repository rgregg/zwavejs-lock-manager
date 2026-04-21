import { mkdir, rename, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export interface AtomicWriteOptions {
  mode?: number;
}

export async function atomicWriteFile(
  path: string,
  contents: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, contents, { encoding: "utf8" });
  if (options.mode !== undefined) {
    await chmod(tmp, options.mode);
  }
  await rename(tmp, path);
}
