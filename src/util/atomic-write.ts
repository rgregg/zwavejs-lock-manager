import { mkdir, rename, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";

export interface AtomicWriteOptions {
  mode?: number;
}

export async function atomicWriteFile(
  path: string,
  contents: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents, { encoding: "utf8" });
  if (options.mode !== undefined) {
    await chmod(tmp, options.mode);
  }
  await rename(tmp, path);
}
