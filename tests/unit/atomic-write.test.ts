import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFile } from "../../src/util/atomic-write.js";

describe("atomicWriteFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "atomic-"));
  });

  it("writes the contents to the target path", async () => {
    const target = join(dir, "data.json");
    await atomicWriteFile(target, '{"a":1}');
    expect(await readFile(target, "utf8")).toBe('{"a":1}');
  });

  it("creates parent directories when missing", async () => {
    const target = join(dir, "nested", "deep", "file.txt");
    await atomicWriteFile(target, "hello");
    expect(await readFile(target, "utf8")).toBe("hello");
  });

  it("overwrites an existing file atomically (no .tmp left behind)", async () => {
    const target = join(dir, "data.json");
    await atomicWriteFile(target, "first");
    await atomicWriteFile(target, "second");
    expect(await readFile(target, "utf8")).toBe("second");
    await expect(stat(`${target}.tmp`)).rejects.toThrow();
  });

  it("applies mode 0o600 when requested", async () => {
    const target = join(dir, "secret.json");
    await atomicWriteFile(target, "shh", { mode: 0o600 });
    const s = await stat(target);
    expect(s.mode & 0o777).toBe(0o600);
  });
});
