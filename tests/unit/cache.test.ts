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

  it("markDrifted sets drifted: true on an existing slot", async () => {
    const { cache } = await makeCache();
    await cache.markWrite("front-door", 3, { userId: "u1", pinFingerprint: "sha256:abc" });
    await cache.markDrifted("front-door", 3);
    const slot = cache.getLock("front-door")?.slots["3"];
    expect(slot?.drifted).toBe(true);
    // original fields should be preserved
    expect(slot?.status).toBe("enabled");
    expect(slot?.userId).toBe("u1");
  });

  it("markDrifted is a no-op for a slot that does not exist", async () => {
    const { cache } = await makeCache();
    // should not throw and should not create a slot
    await cache.markDrifted("front-door", 99);
    expect(cache.getLock("front-door")?.slots["99"]).toBeUndefined();
  });

  it("clearSlotDrift resets slot to unknown and removes drifted flag", async () => {
    const { cache } = await makeCache();
    await cache.markWrite("front-door", 3, { userId: "u1", pinFingerprint: "sha256:abc" });
    await cache.markDrifted("front-door", 3);
    await cache.clearSlotDrift("front-door", 3);
    const slot = cache.getLock("front-door")?.slots["3"];
    expect(slot?.status).toBe("unknown");
    expect(slot?.drifted).toBeUndefined();
  });

  it("replaceLock with drifted array marks specified slots as drifted", async () => {
    const { cache } = await makeCache();
    const now = new Date().toISOString();
    await cache.replaceLock("front-door", {
      "1": { status: "enabled", userId: "u1", pinFingerprint: "sha256:a", updatedAt: now },
      "2": { status: "enabled", userId: "u2", pinFingerprint: "sha256:b", updatedAt: now },
    }, [2]);
    expect(cache.getLock("front-door")?.slots["1"]?.drifted).toBeUndefined();
    expect(cache.getLock("front-door")?.slots["2"]?.drifted).toBe(true);
  });

  it("adoptSlot binds a userId, keeps the fingerprint, and clears drifted + pin", async () => {
    const { cache } = await makeCache();
    await cache.replaceLock(
      "front",
      { "3": { status: "enabled", pinFingerprint: "sha256:abc", pin: "1234", updatedAt: "t" } },
      [3],
    );
    await cache.adoptSlot("front", 3, "u_new");
    const slot = cache.getLock("front")?.slots["3"];
    expect(slot?.userId).toBe("u_new");
    expect(slot?.pinFingerprint).toBe("sha256:abc");
    expect(slot?.drifted).toBeUndefined();
    expect(slot?.pin).toBeUndefined();
  });

  it("adoptSlot throws if slot is not enabled", async () => {
    const { cache } = await makeCache();
    await cache.replaceLock("front", { "3": { status: "empty", updatedAt: "t" } });
    await expect(cache.adoptSlot("front", 3, "u_new")).rejects.toThrow(/not enabled/i);
  });
});
