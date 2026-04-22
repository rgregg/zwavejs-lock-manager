import type { SlotState } from "../cache/types.js";
import { fingerprintPin } from "../cache/fingerprint.js";

export interface DiffUser {
  id: string;
  name: string;
  pin: string;
  slot: number;
  enabled: boolean;
}

export type Op =
  | { op: "set"; slot: number; pin: string; userId: string }
  | { op: "clear"; slot: number };

export interface DiffInput {
  users: readonly DiffUser[];
  cache: Record<string, SlotState>;
  secret: string;
}

export function computeDiff(input: DiffInput): Op[] {
  const ops: Op[] = [];
  const desiredSlots = new Set<number>();

  for (const user of input.users) {
    desiredSlots.add(user.slot);
    const slotKey = String(user.slot);
    const current = input.cache[slotKey];
    const wantEnabled = user.enabled;

    // Skip drifted slots — they are flagged for human review, not auto-healed
    if (current?.drifted) continue;

    if (wantEnabled) {
      const expectedFp = fingerprintPin(input.secret, user.pin);
      const matches =
        current?.status === "enabled" &&
        current.userId === user.id &&
        current.pinFingerprint === expectedFp;
      if (!matches) {
        ops.push({ op: "set", slot: user.slot, pin: user.pin, userId: user.id });
      }
    } else {
      if (current && current.status !== "empty") {
        ops.push({ op: "clear", slot: user.slot });
      }
    }
  }

  for (const [slotKey, slot] of Object.entries(input.cache)) {
    const slotNum = Number(slotKey);
    if (desiredSlots.has(slotNum)) continue;
    // Skip drifted slots — they are flagged for human review, not auto-healed
    if (slot.drifted) continue;
    if (slot.status === "enabled") {
      ops.push({ op: "clear", slot: slotNum });
    }
  }

  ops.sort((a, b) => a.slot - b.slot);
  return ops;
}
