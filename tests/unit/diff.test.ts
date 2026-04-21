import { describe, it, expect } from "vitest";
import { computeDiff } from "../../src/reconciler/diff.js";
import { fingerprintPin } from "../../src/cache/fingerprint.js";

const SECRET = "local-secret";

function fp(pin: string) {
  return fingerprintPin(SECRET, pin);
}

describe("computeDiff", () => {
  it("enables a new enabled user in an empty cache", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }],
      cache: {},
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "set", slot: 3, pin: "1234", userId: "u1" }]);
  });

  it("returns no ops when cache matches desired", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([]);
  });

  it("writes when pin differs (fingerprint mismatch)", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "9999", slot: 3, enabled: true }],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "set", slot: 3, pin: "9999", userId: "u1" }]);
  });

  it("ignores renames (name is not on the lock)", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Allison", pin: "1234", slot: 3, enabled: true }],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([]);
  });

  it("clears slots for disabled users when cache shows enabled", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: false }],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "clear", slot: 3 }]);
  });

  it("does nothing for disabled user when cache already empty", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: false }],
      cache: {
        "3": { status: "empty", updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([]);
  });

  it("clears slots present in cache but absent from desired users (deletion)", () => {
    const ops = computeDiff({
      users: [],
      cache: {
        "3": { status: "enabled", userId: "u1", pinFingerprint: fp("1234"), updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "clear", slot: 3 }]);
  });

  it("writes when cache slot is unknown even if fingerprint would match", () => {
    const ops = computeDiff({
      users: [{ id: "u1", name: "Alice", pin: "1234", slot: 3, enabled: true }],
      cache: {
        "3": { status: "unknown", updatedAt: "" },
      },
      secret: SECRET,
    });
    expect(ops).toEqual([{ op: "set", slot: 3, pin: "1234", userId: "u1" }]);
  });
});
