import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockStateCache } from "../../src/cache/cache.js";
import { Store } from "../../src/store/store.js";
import { buildServer } from "../../src/http/server.js";
import type { FastifyInstance } from "fastify";

describe("locks routes", () => {
  let app: FastifyInstance;
  let cache: LockStateCache;
  let store: Store;
  let resyncCalls: string[];
  let verifyCalls: string[];

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "httpl-"));
    cache = new LockStateCache({ path: join(dir, "state.json") });
    await cache.load();
    store = new Store({ path: join(dir, "users.json"), maxSlots: 30 });
    await store.load();
    resyncCalls = [];
    verifyCalls = [];
    app = buildServer({
      locks: [
        { id: "front-door", name: "Front Door", nodeId: 7, maxCodeSlots: 30 },
        { id: "back-door", name: "Back Door", nodeId: 9, maxCodeSlots: 30 },
      ],
      cache,
      store,
      onResync: (id) => resyncCalls.push(id),
      onVerify: (id) => verifyCalls.push(id),
    });
  });

  afterEach(async () => await app.close());

  it("GET /locks lists configured locks and status", async () => {
    await cache.markReconcile("front-door", "ok");
    const res = await app.inject({ method: "GET", url: "/locks" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Front Door");
    expect(res.body).toContain("Back Door");
    expect(res.body).toContain("ok");
  });

  it("POST /locks/:id/resync invokes onResync", async () => {
    const res = await app.inject({ method: "POST", url: "/locks/front-door/resync" });
    expect(res.statusCode).toBe(302);
    expect(resyncCalls).toEqual(["front-door"]);
  });

  it("POST /locks/:id/verify invokes onVerify", async () => {
    const res = await app.inject({ method: "POST", url: "/locks/back-door/verify" });
    expect(res.statusCode).toBe(302);
    expect(verifyCalls).toEqual(["back-door"]);
  });

  it("unknown lock id returns 404", async () => {
    const res = await app.inject({ method: "POST", url: "/locks/nope/resync" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /locks/:id/drift renders drifted slots with PINs", async () => {
    await cache.replaceLock(
      "front-door",
      {
        "3": { status: "enabled", pinFingerprint: "sha256:abc", pin: "1234", updatedAt: "t" },
        "4": { status: "empty", updatedAt: "t" },
      },
      [3],
    );
    const res = await app.inject({ method: "GET", url: "/locks/front-door/drift" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Slot");
    expect(res.body).toContain("1234");
    expect(res.body).toContain("Adopt");
  });

  it("GET /locks/:id/drift with no drift shows empty state", async () => {
    const res = await app.inject({ method: "GET", url: "/locks/front-door/drift" });
    expect(res.body).toContain("No drift on this lock");
  });

  it("POST /locks/:id/drift/adopt creates a user at the drifted slot, clears drift", async () => {
    await cache.replaceLock(
      "front-door",
      { "5": { status: "enabled", pinFingerprint: "sha256:xyz", pin: "5555", updatedAt: "t" } },
      [5],
    );
    const res = await app.inject({
      method: "POST",
      url: "/locks/front-door/drift/adopt",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "slot=5&name=Adopted+User",
    });
    expect(res.statusCode).toBe(302);
    expect(store.listUsers()).toHaveLength(1);
    expect(store.listUsers()[0]?.slot).toBe(5);
    expect(store.listUsers()[0]?.pin).toBe("5555");
    expect(cache.getLock("front-door")?.slots["5"]?.drifted).toBeUndefined();
    expect(cache.getLock("front-door")?.slots["5"]?.pin).toBeUndefined();
    expect(cache.getLock("front-door")?.slots["5"]?.userId).toBe(store.listUsers()[0]?.id);
  });

  it("POST .../drift/adopt returns 400 if slot is not drifted", async () => {
    await cache.replaceLock("front-door", { "5": { status: "enabled", pinFingerprint: "sha256:xyz", updatedAt: "t" } });
    const res = await app.inject({
      method: "POST",
      url: "/locks/front-door/drift/adopt",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "slot=5&name=X",
    });
    expect(res.statusCode).toBe(400);
  });
});
