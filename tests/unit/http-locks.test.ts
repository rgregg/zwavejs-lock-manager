import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockStateCache } from "../../src/cache/cache.js";
import { buildServer } from "../../src/http/server.js";
import type { FastifyInstance } from "fastify";

describe("locks routes", () => {
  let app: FastifyInstance;
  let cache: LockStateCache;
  let resyncCalls: string[];
  let verifyCalls: string[];

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "httpl-"));
    cache = new LockStateCache({ path: join(dir, "state.json") });
    await cache.load();
    resyncCalls = [];
    verifyCalls = [];
    app = buildServer({
      locks: [
        { id: "front-door", name: "Front Door", nodeId: 7, maxCodeSlots: 30 },
        { id: "back-door", name: "Back Door", nodeId: 9, maxCodeSlots: 30 },
      ],
      cache,
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
});
