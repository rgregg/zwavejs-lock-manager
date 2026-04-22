import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockZwaveJsServer } from "../helpers/mock-zwavejs-server.js";
import { buildApp, type RunningApp } from "../../src/app.js";
import type { RecordedCommand } from "../helpers/mock-zwavejs-server.js";

describe("app startup", () => {
  let server: MockZwaveJsServer;
  let app: RunningApp | undefined;
  let dataDir: string;
  let haFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    server = new MockZwaveJsServer();
    await server.start();
    server.onCommand("node.set_value", () => null);
    server.onCommand("node.get_value", () => 0);

    dataDir = await mkdtemp(join(tmpdir(), "app-"));
    await writeFile(
      join(dataDir, "locks.yaml"),
      [
        "zwaveJs: { url: " + server.url() + " }",
        "homeAssistant: { url: http://ha.local, token: t, notify: { service: notify.x } }",
        "verify: { intervalDays: 7, staggerMinutes: 0 }",
        "locks:",
        "  - { id: front, name: Front, nodeId: 7, maxCodeSlots: 30 }",
      ].join("\n"),
    );

    haFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", haFetch);
  });

  afterEach(async () => {
    await app?.stop();
    await server.stop();
    vi.unstubAllGlobals();
  });

  it("starts, reconciles new users, and fires notifications on unlock", async () => {
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    const user = await app.store.addUser({ name: "Alice", pin: "1234" });
    await app.waitForIdle();

    const setCalls = server.commands.filter(
      (c) =>
        c.command === "node.set_value" &&
        (c.args?.valueId as { property?: string } | undefined)?.property === "userCode",
    );
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.args).toMatchObject({ nodeId: 7, value: "1234" });

    server.pushEvent({
      source: "node",
      event: "notification",
      nodeId: 7,
      args: { userId: user.slot },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(haFetch).toHaveBeenCalled();
    const body = JSON.parse(haFetch.mock.calls.at(-1)![1].body as string);
    expect(body.message).toBe("Alice unlocked Front");
  });

  it("detects drift during verify and does not overwrite drifted slot on next addUser", async () => {
    // Add a user with a known pin before starting
    app = await buildApp({ dataDir, localSecret: "s" });

    // Pre-populate the user so we know the slot (slot 1 is first allocated)
    const user = await app.store.addUser({ name: "Bob", pin: "5678" });
    const driftedSlot = user.slot;

    // Mock: for verify (getAllUserCodes), the lock reports slot driftedSlot as ENABLED
    // with a DIFFERENT pin (keypad-set "9999") — this should be detected as drift.
    // All other slots are empty (status=0).
    server.onCommand("node.get_value", (cmd: RecordedCommand) => {
      const valueId = cmd.args?.valueId as { property?: string; propertyKey?: number } | undefined;
      if (valueId?.property === "userIdStatus" && valueId.propertyKey === driftedSlot) {
        return 1; // enabled
      }
      if (valueId?.property === "userCode" && valueId.propertyKey === driftedSlot) {
        return "9999"; // keypad-set pin, differs from desired "5678"
      }
      return 0; // all other slots empty
    });

    await app.start();
    await app.waitForIdle();

    // Trigger verify for the front lock
    const verifyPromise = new Promise<void>((resolve) => {
      // Wait for verify to settle by observing cache state
      const check = () => {
        const state = app!.cache.getLock("front");
        if (state?.lastVerifiedAt) resolve();
        else setTimeout(check, 20);
      };
      setTimeout(check, 20);
    });
    await verifyPromise;

    // The cache should mark the slot as drifted
    const state = app.cache.getLock("front");
    expect(state?.slots[String(driftedSlot)]?.drifted).toBe(true);

    // Clear the command log so we can observe what happens next
    server.commands.length = 0;

    // Reset mock back to default (all empty)
    server.onCommand("node.get_value", () => 0);

    // Add a second user — this triggers a reconcile, but the drifted slot should NOT be written
    await app.store.addUser({ name: "Carol", pin: "1111" });
    await app.waitForIdle();

    // No set_value commands should target the drifted slot
    const setCalls = server.commands.filter(
      (c) =>
        c.command === "node.set_value" &&
        (c.args?.valueId as { property?: string; propertyKey?: number } | undefined)
          ?.propertyKey === driftedSlot,
    );
    expect(setCalls).toHaveLength(0);
  });
});
