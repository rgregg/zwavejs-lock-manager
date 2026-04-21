import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadLocksConfig } from "../../src/config/loader.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("loadLocksConfig", () => {
  it("parses a valid file and interpolates env vars", async () => {
    const cfg = await loadLocksConfig(join(FIXTURES, "locks.valid.yaml"), {
      env: { HA_TOKEN: "abc.def.ghi" },
    });
    expect(cfg.zwaveJs.url).toBe("ws://zwavejs:3000");
    expect(cfg.homeAssistant.token).toBe("abc.def.ghi");
    expect(cfg.locks).toHaveLength(2);
    expect(cfg.locks[0]).toMatchObject({ id: "front-door", nodeId: 7, maxCodeSlots: 30 });
  });

  it("rejects when zwaveJs.url is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cfg-"));
    const path = join(dir, "bad.yaml");
    await writeFile(path, "locks: []\n");
    await expect(loadLocksConfig(path, { env: {} })).rejects.toThrow(/zwaveJs/);
  });

  it("rejects duplicate lock ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cfg-"));
    const path = join(dir, "dup.yaml");
    await writeFile(
      path,
      [
        "zwaveJs: { url: ws://z:3000 }",
        "homeAssistant: { url: http://h, token: t, notify: { service: notify.x } }",
        "locks:",
        "  - { id: a, name: A, nodeId: 1, maxCodeSlots: 30 }",
        "  - { id: a, name: B, nodeId: 2, maxCodeSlots: 30 }",
      ].join("\n"),
    );
    await expect(loadLocksConfig(path, { env: {} })).rejects.toThrow(/duplicate lock id/i);
  });

  it("rejects duplicate nodeIds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cfg-"));
    const path = join(dir, "dup-node.yaml");
    await writeFile(
      path,
      [
        "zwaveJs: { url: ws://z:3000 }",
        "homeAssistant: { url: http://h, token: t, notify: { service: notify.x } }",
        "locks:",
        "  - { id: a, name: A, nodeId: 1, maxCodeSlots: 30 }",
        "  - { id: b, name: B, nodeId: 1, maxCodeSlots: 30 }",
      ].join("\n"),
    );
    await expect(loadLocksConfig(path, { env: {} })).rejects.toThrow(/duplicate nodeId/i);
  });

  it("leaves unresolved env vars as empty string and records a warning", async () => {
    const cfg = await loadLocksConfig(join(FIXTURES, "locks.valid.yaml"), { env: {} });
    expect(cfg.homeAssistant.token).toBe("");
    expect(cfg.warnings).toContain("Unresolved env var: HA_TOKEN");
  });

  it("interpolates env vars inside quoted strings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cfg-"));
    const path = join(dir, "quoted.yaml");
    await writeFile(
      path,
      [
        'zwaveJs: { url: "ws://z:3000" }',
        'homeAssistant: { url: "http://h", token: "${HA_TOKEN}", notify: { service: "notify.x" } }',
        "locks: []",
      ].join("\n"),
    );
    const cfg = await loadLocksConfig(path, { env: { HA_TOKEN: "hello" } });
    expect(cfg.homeAssistant.token).toBe("hello");
  });
});
