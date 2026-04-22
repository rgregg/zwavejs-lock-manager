import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    server.onCommand("node.poll_value", () => ({ value: 0 }));

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
    expect(app.store).toBeDefined();
    const user = await app.store!.addUser({ name: "Alice", pin: "1234" });
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
    expect(app.store).toBeDefined();
    const user = await app.store!.addUser({ name: "Bob", pin: "5678" });
    const driftedSlot = user.slot;

    // Mock: for verify (getAllUserCodes), the lock reports slot driftedSlot as ENABLED
    // with a DIFFERENT pin (keypad-set "9999") — this should be detected as drift.
    // All other slots are empty (status=0).
    server.onCommand("node.poll_value", (cmd: RecordedCommand) => {
      const valueId = cmd.args?.valueId as { property?: string; propertyKey?: number } | undefined;
      if (valueId?.property === "userIdStatus" && valueId.propertyKey === driftedSlot) {
        return { value: 1 }; // enabled
      }
      if (valueId?.property === "userCode" && valueId.propertyKey === driftedSlot) {
        return { value: "9999" }; // keypad-set pin, differs from desired "5678"
      }
      return { value: 0 }; // all other slots empty
    });

    await app.start();
    await app.waitForIdle();

    // Trigger verify for the front lock
    const verifyPromise = new Promise<void>((resolve) => {
      // Wait for verify to settle by observing cache state
      const check = () => {
        const state = app!.cache!.getLock("front");
        if (state?.lastVerifiedAt) resolve();
        else setTimeout(check, 20);
      };
      setTimeout(check, 20);
    });
    await verifyPromise;

    // The cache should mark the slot as drifted
    const state = app.cache!.getLock("front");
    expect(state?.slots[String(driftedSlot)]?.drifted).toBe(true);

    // Clear the command log so we can observe what happens next
    server.commands.length = 0;

    // Reset mock back to default (all empty)
    server.onCommand("node.poll_value", () => ({ value: 0 }));

    // Add a second user — this triggers a reconcile, but the drifted slot should NOT be written
    await app.store!.addUser({ name: "Carol", pin: "1111" });
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

  it("binds userId on non-drifted slots that match a desired user after verify", async () => {
    // Preload users.json with a user at slot 3 with pin "1234"
    app = await buildApp({ dataDir, localSecret: "s" });
    expect(app.store).toBeDefined();
    const user = await app.store!.addUser({ name: "Dana", pin: "1234" });
    // Ensure the user lands in slot 3 by filling slots 1 and 2 first if needed
    // (addUser assigns slots sequentially, so user is at slot 1 unless prior users exist)
    // We'll work with whatever slot was assigned.
    const targetSlot = user.slot;

    // Write a small locks.yaml with maxCodeSlots: 5 so verify only reads 5 slots
    await writeFile(
      join(dataDir, "locks.yaml"),
      [
        "zwaveJs: { url: " + server.url() + " }",
        "homeAssistant: { url: http://ha.local, token: t, notify: { service: notify.x } }",
        "verify: { intervalDays: 7, staggerMinutes: 0 }",
        "locks:",
        "  - { id: front, name: Front, nodeId: 7, maxCodeSlots: 5 }",
      ].join("\n"),
    );

    // Mock: lock reports targetSlot as enabled with the matching pin "1234"
    // All other slots are empty (status=0)
    server.onCommand("node.poll_value", (cmd: RecordedCommand) => {
      const valueId = cmd.args?.valueId as { property?: string; propertyKey?: number } | undefined;
      if (valueId?.property === "userIdStatus" && valueId.propertyKey === targetSlot) {
        return { value: 1 }; // enabled
      }
      if (valueId?.property === "userCode" && valueId.propertyKey === targetSlot) {
        return { value: "1234" }; // matches desired PIN exactly — no drift
      }
      return { value: 0 }; // all other slots empty
    });

    // Rebuild the app so it picks up the new locks.yaml with maxCodeSlots: 5
    await app.stop();
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    await app.waitForIdle();

    // Wait for verify to complete (first-run verify happens on start for cache-less locks)
    await new Promise<void>((resolve) => {
      const check = () => {
        const state = app!.cache!.getLock("front");
        if (state?.lastVerifiedAt) resolve();
        else setTimeout(check, 20);
      };
      setTimeout(check, 20);
    });

    const state = app!.cache!.getLock("front");
    const slotState = state?.slots[String(targetSlot)];

    // userId must be bound — the slot matched a desired user, so no write is needed
    expect(slotState?.userId).toBe(user.id);
    // Must not be flagged as drifted
    expect(slotState?.drifted).toBeUndefined();
    // pinFingerprint must be set
    expect(slotState?.pinFingerprint).toBeDefined();
  });

  it("appends a write event to events.jsonl after reconcile", async () => {
    app = await buildApp({ dataDir, localSecret: "s" });
    await app.start();
    expect(app.store).toBeDefined();
    await app.store!.addUser({ name: "Alice", pin: "1234" });
    await app.waitForIdle();

    const eventsPath = join(dataDir, "events.jsonl");
    await new Promise((r) => setTimeout(r, 50)); // let the fire-and-forget append settle
    const raw = await readFile(eventsPath, "utf8");
    const lines = raw.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.some((e) => e.type === "write" && e.outcome === "ok")).toBe(true);
  });
});
