import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockStateCache } from "../../src/cache/cache.js";

async function makeCache() {
  const dir = await mkdtemp(join(tmpdir(), "cache-"));
  const path = join(dir, "state.json");
  const cache = new LockStateCache({ path });
  await cache.load();
  return { cache, path };
}

describe("LockStateCache", () => {
  it("returns undefined for unknown locks", async () => {
    const { cache } = await makeCache();
    expect(cache.getLock("front-door")).toBeUndefined();
  });

  it("markWrite records an enabled slot with userId and fingerprint", async () => {
    const { cache } = await makeCache();
    await cache.markWrite("front-door", 3, { userId: "u1", pinFingerprint: "sha256:abc" });
    expect(cache.getLock("front-door")?.slots["3"]).toMatchObject({
      status: "enabled",
      userId: "u1",
      pinFingerprint: "sha256:abc",
    });
  });

  it("markCleared marks a slot empty and drops the userId", async () => {
    const { cache } = await makeCache();
    await cache.markWrite("front-door", 3, { userId: "u1", pinFingerprint: "sha256:abc" });
    await cache.markCleared("front-door", 3);
    const slot = cache.getLock("front-door")?.slots["3"];
    expect(slot?.status).toBe("empty");
    expect(slot?.userId).toBeUndefined();
  });

  it("markReconcile records outcome + timestamp", async () => {
    const { cache } = await makeCache();
    await cache.markReconcile("front-door", "ok");
    expect(cache.getLock("front-door")?.lastReconcileOutcome).toBe("ok");
    expect(cache.getLock("front-door")?.lastReconcileAt).toBeDefined();
  });

  it("markVerified records verified timestamp", async () => {
    const { cache } = await makeCache();
    await cache.markVerified("front-door");
    expect(cache.getLock("front-door")?.lastVerifiedAt).toBeDefined();
  });

  it("persists to file atomically", async () => {
    const { cache, path } = await makeCache();
    await cache.markWrite("front-door", 1, { userId: "u1", pinFingerprint: "sha256:a" });
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.locks["front-door"].slots["1"].userId).toBe("u1");
  });

  it("reloads persisted state", async () => {
    const { cache, path } = await makeCache();
    await cache.markWrite("front-door", 1, { userId: "u1", pinFingerprint: "sha256:a" });
    const cache2 = new LockStateCache({ path });
    await cache2.load();
    expect(cache2.getLock("front-door")?.slots["1"]?.userId).toBe("u1");
  });

  it("dropLock removes a lock entry (for removed locks in config)", async () => {
    const { cache } = await makeCache();
    await cache.markWrite("old", 1, { userId: "u1", pinFingerprint: "sha256:a" });
    await cache.dropLock("old");
    expect(cache.getLock("old")).toBeUndefined();
  });
});
