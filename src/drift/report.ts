import { fingerprintPin } from "../cache/fingerprint.js";
import type { LockState } from "../cache/types.js";
import type { User } from "../store/types.js";

export type UserDriftStatus = "in_place" | "wrong_slot" | "absent";

export interface UserRow {
  user: User;
  status: UserDriftStatus;
  /** For `wrong_slot`: the slot where this user's PIN actually is. */
  foundInSlot?: number;
}

export interface LockCode {
  slot: number;
  pin: string;
  /** A user whose PIN matches this code (may be assigned to a different slot). */
  matchesUser?: { id: string; name: string; assignedSlot: number };
  /** A user assigned to this slot number — adopting here would conflict. */
  assignedUser?: { id: string; name: string };
}

export interface DriftReport {
  userRows: UserRow[];
  lockCodes: LockCode[];
}

/**
 * Derive a user-centric view of lock drift: for each managed user, whether their
 * PIN is in place, in a different slot, or absent; and for each code physically
 * on the lock that isn't an assigned user's in-place PIN, how it relates to the
 * managed users (matches someone / occupies someone's slot / unknown).
 *
 * Comparison is by HMAC fingerprint — the same value the cache already stores
 * per slot — so no plaintext PINs are compared.
 */
export function buildDriftReport(
  state: LockState | undefined,
  users: readonly User[],
  secret: string,
): DriftReport {
  const enabledSlots = Object.entries(state?.slots ?? {})
    .filter(([, s]) => s.status === "enabled")
    .map(([k, s]) => ({ slot: Number(k), fp: s.pinFingerprint, pin: s.pin ?? "" }));

  const enabledUsers = users.filter((u) => u.enabled);
  const userFp = new Map(enabledUsers.map((u) => [u.id, fingerprintPin(secret, u.pin)]));
  // Slot assignment considers ALL users (incl. disabled) — that's what a slot
  // conflict in store.addUser is checked against.
  const userBySlot = new Map(users.map((u) => [u.slot, u]));

  const userRows: UserRow[] = enabledUsers.map((u) => {
    const fp = userFp.get(u.id);
    if (enabledSlots.some((e) => e.slot === u.slot && e.fp === fp)) {
      return { user: u, status: "in_place" };
    }
    const elsewhere = enabledSlots.find((e) => e.fp === fp && e.slot !== u.slot);
    if (elsewhere) {
      return { user: u, status: "wrong_slot", foundInSlot: elsewhere.slot };
    }
    return { user: u, status: "absent" };
  });

  const lockCodes: LockCode[] = [];
  for (const e of enabledSlots) {
    const assigned = userBySlot.get(e.slot);
    const matches = enabledUsers.find((u) => userFp.get(u.id) === e.fp);
    // Skip codes that are an assigned user's own PIN sitting in their own slot.
    if (assigned && matches && assigned.id === matches.id) continue;
    const code: LockCode = { slot: e.slot, pin: e.pin };
    if (matches) {
      code.matchesUser = { id: matches.id, name: matches.name, assignedSlot: matches.slot };
    }
    if (assigned) {
      code.assignedUser = { id: assigned.id, name: assigned.name };
    }
    lockCodes.push(code);
  }

  return { userRows, lockCodes };
}
