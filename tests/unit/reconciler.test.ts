import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockStateCache } from "../../src/cache/cache.js";
import { Reconciler } from "../../src/reconciler/reconciler.js";
import type { LockWriter, LockSyncTarget } from "../../src/reconciler/types.js";

interface CallLog {
  op: "set" | "clear";
  nodeId: number;
  slot: number;
  pin?: string;
}

function makeWriter(failures: Record<string, number> = {}): {
  writer: LockWriter;
  calls: CallLog[];
} {
  const calls: CallLog[] = [];
  const counters = { ...failures };
  const maybeFail = (key: string) => {
    if ((counters[key] ?? 0) > 0) {
      counters[key]! -= 1;
      throw new Error(`simulated failure: ${key}`);
    }
  };
  const writer: LockWriter = {
    async setUserCode(nodeId, slot, pin) {
      maybeFail(`set-${nodeId}-${slot}`);
      calls.push({ op: "set", nodeId, slot, pin });
    },
    async clearUserCode(nodeId, slot) {
      maybeFail(`clear-${nodeId}-${slot}`);
      calls.push({ op: "clear", nodeId, slot });
    },
  };
  return { writer, calls };
}

async function makeCache() {
  const dir = await mkdtemp(join(tmpdir(), "rec-"));
  const cache = new LockStateCache({ path: join(dir, "state.json") });
  await cache.load();
  return cache;
}

const LOCKS: LockSyncTarget[] = [
  { id: "front-door", nodeId: 7, maxCodeSlots: 30 },
  { id: "back-door", nodeId: 9, maxCodeSlots: 30 },
];
const SECRET = "s";

describe("Reconciler", () => {
  let cache: LockStateCache;
  beforeEach(async () => {
    cache = await makeCache();
  });

  it("sets a new code on every lock", async () => {
    const { writer, calls } = makeWriter();
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
    });
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    expect(calls).toEqual([
      { op: "set", nodeId: 7, slot: 3, pin: "1234" },
      { op: "set", nodeId: 9, slot: 3, pin: "1234" },
    ]);
    expect(cache.getLock("front-door")?.slots["3"]?.status).toBe("enabled");
    expect(cache.getLock("front-door")?.lastReconcileOutcome).toBe("ok");
  });

  it("issues no writes when cache matches desired", async () => {
    const { writer, calls } = makeWriter();
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
    });
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    calls.length = 0;
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    expect(calls).toEqual([]);
  });

  it("clears slots for deleted users", async () => {
    const { writer, calls } = makeWriter();
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
    });
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    calls.length = 0;
    await rec.reconcileAll([]);
    expect(calls).toEqual([
      { op: "clear", nodeId: 7, slot: 3 },
      { op: "clear", nodeId: 9, slot: 3 },
    ]);
  });

  it("retries up to the configured count before marking error", async () => {
    const { writer, calls } = makeWriter({ "set-7-3": 3 });
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 2,
      debounceMs: 0,
      retryDelayMs: 1,
    });
    await rec.reconcileAll([{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }]);
    const setsOnFront = calls.filter((c) => c.nodeId === 7 && c.op === "set");
    expect(setsOnFront).toHaveLength(0);
    expect(cache.getLock("front-door")?.lastReconcileOutcome).toBe("error");
    expect(cache.getLock("back-door")?.lastReconcileOutcome).toBe("ok");
  });

  it("serializes writes within a single lock (FIFO)", async () => {
    const order: number[] = [];
    const writer: LockWriter = {
      async setUserCode(_n, slot) {
        await new Promise((r) => setTimeout(r, 5));
        order.push(slot);
      },
      async clearUserCode() {},
    };
    const rec = new Reconciler({
      cache,
      writer,
      locks: [LOCKS[0]!],
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
    });
    await rec.reconcileAll([
      { id: "u1", name: "A", pin: "1111", slot: 1, enabled: true },
      { id: "u2", name: "B", pin: "2222", slot: 2, enabled: true },
      { id: "u3", name: "C", pin: "3333", slot: 3, enabled: true },
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("invokes onWriteResult for each op with outcome", async () => {
    const cache = await makeCache();
    const { writer, calls } = makeWriter();
    const results: Array<{ lockId: string; slot: number; outcome: "ok" | "error" }> = [];
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
      onWriteResult: (e) => { results.push(e); },
    });
    await rec.reconcileAll([{ id: "u1", name: "A", pin: "1111", slot: 1, enabled: true }]);
    expect(calls).toHaveLength(2); // ensure writes happened
    expect(results).toEqual([
      { lockId: "front-door", slot: 1, outcome: "ok" },
      { lockId: "back-door", slot: 1, outcome: "ok" },
    ]);
  });

  it("invokes onWriteResult with outcome=error when retries exhausted", async () => {
    const cache = await makeCache();
    const { writer } = makeWriter({ "set-7-1": 1 });
    const results: Array<{ outcome: "ok" | "error" }> = [];
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
      retryDelayMs: 1,
      onWriteResult: (e) => { results.push({ outcome: e.outcome }); },
    });
    await rec.reconcileAll([{ id: "u1", name: "A", pin: "1111", slot: 1, enabled: true }]);
    // front-door fails, back-door succeeds
    expect(results).toEqual([{ outcome: "error" }, { outcome: "ok" }]);
  });

  it("reconcileLockOnly reconciles a single lock, not others", async () => {
    const cache = await makeCache();
    const { writer, calls } = makeWriter();
    const rec = new Reconciler({ cache, writer, locks: LOCKS, secret: SECRET, retries: 0, debounceMs: 0 });
    await rec.reconcileLockOnly("front-door", [
      { id: "u1", name: "A", pin: "1111", slot: 1, enabled: true },
    ]);
    const frontCalls = calls.filter((c) => c.nodeId === 7);
    const backCalls = calls.filter((c) => c.nodeId === 9);
    expect(frontCalls).toHaveLength(1);
    expect(backCalls).toHaveLength(0);
  });

  it("reconcileLockOnly throws for unknown lock", async () => {
    const cache = await makeCache();
    const { writer } = makeWriter();
    const rec = new Reconciler({ cache, writer, locks: LOCKS, secret: SECRET });
    await expect(rec.reconcileLockOnly("nope", [])).rejects.toThrow(/unknown lock/i);
  });

  it("debounces rapid scheduleReconcile calls into one pass", async () => {
    const { writer, calls } = makeWriter();
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 20,
    });
    rec.scheduleReconcile(() => [{ id: "u1", name: "A", pin: "1111", slot: 1, enabled: true }]);
    rec.scheduleReconcile(() => [
      { id: "u1", name: "A", pin: "1111", slot: 1, enabled: true },
      { id: "u2", name: "B", pin: "2222", slot: 2, enabled: true },
    ]);
    await rec.drain();
    expect(calls).toHaveLength(4); // 2 slots * 2 locks
  });

  it("readOnly mode skips writes, cache updates, and onWriteResult", async () => {
    const { writer, calls } = makeWriter();
    const writeEvents: unknown[] = [];
    const rec = new Reconciler({
      cache,
      writer,
      locks: LOCKS,
      secret: SECRET,
      retries: 0,
      debounceMs: 0,
      readOnly: true,
      onWriteResult: (e) => {
        writeEvents.push(e);
      },
    });
    await rec.reconcileAll([{ id: "u1", name: "A", pin: "1111", slot: 1, enabled: true }]);
    expect(calls).toEqual([]);
    expect(writeEvents).toEqual([]);
    expect(cache.getLock("front-door")).toBeUndefined();
    expect(cache.getLock("back-door")).toBeUndefined();
  });
});
