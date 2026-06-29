import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocksConfig } from "../../src/config/loader.js";

async function withOptionsFile(opts: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "addon-"));
  await writeFile(join(dir, "options.json"), JSON.stringify(opts));
  return dir;
}

describe("loadLocksConfig (addon mode)", () => {
  it("loads from /data/options.json when SUPERVISOR_TOKEN is set", async () => {
    const dir = await withOptionsFile({
      read_only: true,
      notify_service: "notify.family",
      verify_interval_days: 7,
      verify_stagger_minutes: 60,
      locks: [{ id: "front", name: "Front", node_id: 7, max_code_slots: 30 }],
    });
    const cfg = await loadLocksConfig(join(dir, "options.json"), {
      env: { SUPERVISOR_TOKEN: "tok" },
    });
    expect(cfg.readOnly).toBe(true);
    expect(cfg.homeAssistant.url).toBe("http://supervisor/core");
    expect(cfg.homeAssistant.token).toBe("tok");
    expect(cfg.homeAssistant.notify.service).toBe("notify.family");
    expect(cfg.zwaveJs.url).toBe(""); // filled in later by discovery
    expect(cfg.locks).toEqual([
      { id: "front", name: "Front", nodeId: 7, maxCodeSlots: 30 },
    ]);
  });

  it("applies defaults for omitted optional fields", async () => {
    const dir = await withOptionsFile({
      locks: [{ id: "front", name: "Front", node_id: 7 }],
    });
    const cfg = await loadLocksConfig(join(dir, "options.json"), {
      env: { SUPERVISOR_TOKEN: "tok" },
    });
    expect(cfg.readOnly).toBe(false);
    expect(cfg.homeAssistant.notify.service).toBe("notify.notify");
    expect(cfg.verify.intervalDays).toBe(7);
    expect(cfg.verify.staggerMinutes).toBe(60);
    expect(cfg.locks[0]).toEqual({
      id: "front",
      name: "Front",
      nodeId: 7,
      maxCodeSlots: 30,
    });
  });

  it("uses zwave_url directly when provided (skips the discovery sentinel)", async () => {
    const dir = await withOptionsFile({
      zwave_url: "ws://piworker01.lan:3000",
      locks: [{ id: "front", name: "Front", node_id: 7 }],
    });
    const cfg = await loadLocksConfig(join(dir, "options.json"), {
      env: { SUPERVISOR_TOKEN: "tok" },
    });
    expect(cfg.zwaveJs.url).toBe("ws://piworker01.lan:3000");
  });

  it("treats a blank zwave_url as unset (falls back to discovery sentinel)", async () => {
    const dir = await withOptionsFile({
      zwave_url: "   ",
      locks: [{ id: "front", name: "Front", node_id: 7 }],
    });
    const cfg = await loadLocksConfig(join(dir, "options.json"), {
      env: { SUPERVISOR_TOKEN: "tok" },
    });
    expect(cfg.zwaveJs.url).toBe("");
  });

  it("rejects a malformed zwave_url", async () => {
    const dir = await withOptionsFile({
      zwave_url: "not a url",
      locks: [{ id: "front", name: "Front", node_id: 7 }],
    });
    await expect(
      loadLocksConfig(join(dir, "options.json"), { env: { SUPERVISOR_TOKEN: "tok" } }),
    ).rejects.toThrow();
  });

  it("passes notify_category through when present", async () => {
    const dir = await withOptionsFile({
      notify_service: "notify.family",
      notify_category: "lock",
      locks: [{ id: "front", name: "Front", node_id: 7 }],
    });
    const cfg = await loadLocksConfig(join(dir, "options.json"), {
      env: { SUPERVISOR_TOKEN: "tok" },
    });
    expect(cfg.homeAssistant.notify.category).toBe("lock");
  });

  it("rejects options.json without locks", async () => {
    const dir = await withOptionsFile({ read_only: false });
    await expect(
      loadLocksConfig(join(dir, "options.json"), { env: { SUPERVISOR_TOKEN: "t" } }),
    ).rejects.toThrow();
  });

  it("does not switch to addon mode without SUPERVISOR_TOKEN even if file is options.json", async () => {
    const dir = await withOptionsFile({ read_only: true, locks: [] });
    // path ends in options.json but env is missing SUPERVISOR_TOKEN — should fall
    // through to YAML mode and fail to validate as a LocksConfig.
    await expect(
      loadLocksConfig(join(dir, "options.json"), { env: {} }),
    ).rejects.toThrow();
  });
});
