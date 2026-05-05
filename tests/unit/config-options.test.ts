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

  it("uses zwave_js_url override when provided (skipping discovery)", async () => {
    const dir = await withOptionsFile({
      read_only: false,
      notify_service: "notify.family",
      zwave_js_url: "ws://piworker01.lan:3000",
      verify_interval_days: 7,
      verify_stagger_minutes: 60,
      locks: [{ id: "k", name: "K", node_id: 51, max_code_slots: 30 }],
    });
    const cfg = await loadLocksConfig(join(dir, "options.json"), {
      env: { SUPERVISOR_TOKEN: "tok" },
    });
    expect(cfg.zwaveJs.url).toBe("ws://piworker01.lan:3000");
  });

  it("rejects options.json without locks", async () => {
    const dir = await withOptionsFile({ read_only: false });
    await expect(
      loadLocksConfig(join(dir, "options.json"), { env: { SUPERVISOR_TOKEN: "t" } }),
    ).rejects.toThrow();
  });

  it("does not switch to addon mode without SUPERVISOR_TOKEN even if file is options.json", async () => {
    const dir = await withOptionsFile({ read_only: true, locks: [] });
    // path ends in options.json but env is missing SUPERVISOR_TOKEN — should fall through
    // to YAML mode and fail to parse
    await expect(
      loadLocksConfig(join(dir, "options.json"), { env: {} }),
    ).rejects.toThrow();
  });
});
