import { describe, expect, it } from "vitest";
import { buildDriftReport } from "../../src/drift/report.js";
import { fingerprintPin } from "../../src/cache/fingerprint.js";
import type { LockState, SlotState } from "../../src/cache/types.js";
import type { User } from "../../src/store/types.js";

const SECRET = "test-secret";

function user(over: Partial<User> & Pick<User, "id" | "name" | "pin" | "slot">): User {
  return { enabled: true, createdAt: "t", updatedAt: "t", ...over };
}

function enabledSlot(pin: string, over: Partial<SlotState> = {}): SlotState {
  return {
    status: "enabled",
    pinFingerprint: fingerprintPin(SECRET, pin),
    updatedAt: "t",
    pin,
    ...over,
  };
}

function state(slots: Record<string, SlotState>): LockState {
  return { slots };
}

describe("buildDriftReport", () => {
  it("marks a user in_place when their PIN is enabled in their assigned slot", () => {
    const users = [user({ id: "u1", name: "Alice", pin: "1111", slot: 3 })];
    const r = buildDriftReport(state({ "3": enabledSlot("1111") }), users, SECRET);
    expect(r.userRows).toEqual([{ user: users[0], status: "in_place" }]);
    expect(r.lockCodes).toEqual([]);
  });

  it("marks a user wrong_slot and reports where their PIN actually is", () => {
    const users = [user({ id: "u2", name: "Bob", pin: "2222", slot: 5 })];
    const r = buildDriftReport(state({ "8": enabledSlot("2222") }), users, SECRET);
    expect(r.userRows).toEqual([{ user: users[0], status: "wrong_slot", foundInSlot: 8 }]);
    // The stray code shows up under lock codes, matched to Bob (whose slot is 5)
    expect(r.lockCodes).toEqual([
      { slot: 8, pin: "2222", matchesUser: { id: "u2", name: "Bob", assignedSlot: 5 } },
    ]);
  });

  it("marks a user absent when their PIN is nowhere on the lock", () => {
    const users = [user({ id: "u3", name: "Carol", pin: "3333", slot: 7 })];
    const r = buildDriftReport(state({}), users, SECRET);
    expect(r.userRows).toEqual([{ user: users[0], status: "absent" }]);
    expect(r.lockCodes).toEqual([]);
  });

  it("lists an unknown code in a free slot with no user annotations", () => {
    const r = buildDriftReport(state({ "9": enabledSlot("9999") }), [], SECRET);
    expect(r.lockCodes).toEqual([{ slot: 9, pin: "9999" }]);
  });

  it("flags a foreign code occupying a user's assigned slot (the conflict case)", () => {
    const users = [user({ id: "u2", name: "Bob", pin: "2222", slot: 5 })];
    // Bob is assigned slot 5, but slot 5 physically holds a different code
    const r = buildDriftReport(state({ "5": enabledSlot("7777") }), users, SECRET);
    // Bob's own PIN isn't on the lock -> absent
    expect(r.userRows).toEqual([{ user: users[0], status: "absent" }]);
    // The foreign code names Bob as the assigned user (adopt would conflict)
    expect(r.lockCodes).toEqual([
      { slot: 5, pin: "7777", assignedUser: { id: "u2", name: "Bob" } },
    ]);
  });

  it("excludes disabled users from userRows but still flags their slot as assigned", () => {
    const users = [user({ id: "u4", name: "Dan", pin: "4444", slot: 2, enabled: false })];
    const r = buildDriftReport(state({ "2": enabledSlot("8888") }), users, SECRET);
    expect(r.userRows).toEqual([]);
    expect(r.lockCodes).toEqual([
      { slot: 2, pin: "8888", assignedUser: { id: "u4", name: "Dan" } },
    ]);
  });
});
