import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockStateCache } from "../../src/cache/cache.js";
import { Store } from "../../src/store/store.js";
import { buildServer } from "../../src/http/server.js";
import { fingerprintPin } from "../../src/cache/fingerprint.js";
import type { FastifyInstance } from "fastify";

const SECRET = "s3cr3t";
const LOCK = "front-door";

function form(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
}

describe("drift resolution routes", () => {
  let app: FastifyInstance;
  let cache: LockStateCache;
  let store: Store;
  let changes: number;
  let resyncs: string[];

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "httpd-"));
    cache = new LockStateCache({ path: join(dir, "state.json") });
    await cache.load();
    store = new Store({ path: join(dir, "users.json"), maxSlots: 30 });
    await store.load();
    changes = 0;
    resyncs = [];
    app = buildServer({
      locks: [{ id: LOCK, name: "Front Door", nodeId: 7, maxCodeSlots: 30 }],
      cache,
      store,
      secret: SECRET,
      onResync: (id) => resyncs.push(id),
      onUsersChanged: () => {
        changes += 1;
      },
    });
  });

  afterEach(async () => await app.close());

  const post = (path: string, fields: Record<string, string | number>) =>
    app.inject({
      method: "POST",
      url: `/locks/${LOCK}${path}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: form(fields),
    });

  // A foreign code sits in a slot that a managed user already occupies.
  async function conflictSetup() {
    const bob = await store.addUser({ name: "Bob", pin: "2222", slot: 5 });
    await cache.replaceLock(
      LOCK,
      { "5": { status: "enabled", pinFingerprint: fingerprintPin(SECRET, "7777"), pin: "7777", updatedAt: "t" } },
      [5],
    );
    return bob;
  }

  it("plain adopt into an already-assigned slot no longer 500s", async () => {
    await conflictSetup();
    const res = await post("/drift/adopt", { slot: 5, name: "Dup" });
    expect(res.statusCode).not.toBe(500);
    expect([302, 400, 409]).toContain(res.statusCode);
    // no duplicate user created
    expect(store.listUsers()).toHaveLength(1);
  });

  it("replace repoints the assigned user's PIN to the lock's code and clears drift", async () => {
    const bob = await conflictSetup();
    const res = await post("/drift/replace", { slot: 5 });
    expect(res.statusCode).toBe(302);
    expect(store.getUser(bob.id)?.pin).toBe("7777");
    expect(cache.getLock(LOCK)?.slots["5"]?.drifted).toBeUndefined();
    expect(cache.getLock(LOCK)?.slots["5"]?.userId).toBe(bob.id);
    expect(changes).toBeGreaterThan(0);
  });

  it("adopt-to-free-slot creates a new user in a different, free slot", async () => {
    await conflictSetup();
    const res = await post("/drift/adopt-free", { slot: 5 });
    expect(res.statusCode).toBe(302);
    expect(store.listUsers()).toHaveLength(2);
    const created = store.listUsers().find((u) => u.pin === "7777");
    expect(created).toBeDefined();
    expect(created?.slot).not.toBe(5);
  });

  it("move re-assigns a user to the slot where their PIN actually is", async () => {
    const bob = await store.addUser({ name: "Bob", pin: "2222", slot: 5 });
    // Bob's PIN is physically in slot 8, not his assigned slot 5
    await cache.replaceLock(
      LOCK,
      { "8": { status: "enabled", pinFingerprint: fingerprintPin(SECRET, "2222"), pin: "2222", updatedAt: "t" } },
      [8],
    );
    const res = await post("/drift/move", { userId: bob.id, toSlot: 8 });
    expect(res.statusCode).toBe(302);
    expect(store.getUser(bob.id)?.slot).toBe(8);
    expect(cache.getLock(LOCK)?.slots["8"]?.userId).toBe(bob.id);
    expect(cache.getLock(LOCK)?.slots["8"]?.drifted).toBeUndefined();
  });

  it("move rejects a target slot already held by another user", async () => {
    const bob = await store.addUser({ name: "Bob", pin: "2222", slot: 5 });
    await store.addUser({ name: "Alice", pin: "1111", slot: 8 });
    const res = await post("/drift/move", { userId: bob.id, toSlot: 8 });
    expect([400, 409]).toContain(res.statusCode);
    expect(store.getUser(bob.id)?.slot).toBe(5);
  });

  const getDrift = () => app.inject({ method: "GET", url: `/locks/${LOCK}/drift` });

  it("renders a wrong-slot user with a Move action and where the PIN is", async () => {
    await store.addUser({ name: "Bob", pin: "2222", slot: 5 });
    await cache.replaceLock(
      LOCK,
      { "8": { status: "enabled", pinFingerprint: fingerprintPin(SECRET, "2222"), pin: "2222", updatedAt: "t" } },
      [8],
    );
    const res = await getDrift();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Bob");
    expect(res.body).toContain("found in slot 8");
    expect(res.body).toContain("Move to slot 8");
    expect(res.body).toContain("/drift/move");
  });

  it("renders the conflict case with Replace and Adopt-to-free-slot actions", async () => {
    await store.addUser({ name: "Bob", pin: "2222", slot: 5 });
    await cache.replaceLock(
      LOCK,
      { "5": { status: "enabled", pinFingerprint: fingerprintPin(SECRET, "7777"), pin: "7777", updatedAt: "t" } },
      [5],
    );
    const res = await getDrift();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Slot assigned to");
    expect(res.body).toContain("Replace Bob's PIN");
    expect(res.body).toContain("Adopt to free slot");
    // and it must NOT offer a plain adopt for that occupied slot
    expect(res.body).not.toContain("/drift/adopt\"");
  });

  it("rewrite clears drift on the involved slots and queues a reconcile", async () => {
    await store.addUser({ name: "Bob", pin: "2222", slot: 5 });
    // Bob's code is stray in slot 8; his assigned slot 5 is empty
    await cache.replaceLock(
      LOCK,
      { "8": { status: "enabled", pinFingerprint: fingerprintPin(SECRET, "2222"), pin: "2222", updatedAt: "t" } },
      [8],
    );
    const res = await post("/drift/rewrite", { assignedSlot: 5, straySlot: 8 });
    expect(res.statusCode).toBe(302);
    expect(resyncs).toEqual([LOCK]);
    expect(cache.getLock(LOCK)?.slots["8"]?.drifted).toBeUndefined();
  });
});
