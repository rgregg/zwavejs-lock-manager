# Drift view reorganized around users + safe adopt

Date: 2026-07-02

## Problem

1. Adopting an unknown lock code whose slot is already held by a managed user
   throws `Slot N already taken` from `store.addUser`; the adopt route has no
   error handling, so it surfaces as an unhandled **HTTP 500 + JSON** on screen.
2. The drift page can't show whether a managed user's PIN is **in place**, in a
   **different slot**, or **absent** from the lock. Cause-and-effect is unclear.

## Goals

- No 500 on adopt conflicts; resolve inline (Replace / Adopt-to-free-slot).
- Reorganize the drift view around managed users with a clear per-user status.
- Detect PIN-in-a-different-slot and PIN-absent via fingerprint matching.
- Respect read-only mode: only `users.json` is mutated, never the lock.

## Design

### 1. `buildDriftReport` — new pure module `src/drift/report.ts`

`buildDriftReport(state: LockState | undefined, users: readonly User[], secret: string): DriftReport`

Uses the fingerprints the cache already stores per slot (`SlotState.pinFingerprint`)
and `fingerprintPin(secret, user.pin)` — no plaintext PIN comparison needed. The
adopt-candidate PIN comes from `SlotState.pin` (populated for drifted enabled slots).

```ts
type UserDriftStatus = "in_place" | "wrong_slot" | "absent";
interface UserRow { user: User; status: UserDriftStatus; foundInSlot?: number; }
interface LockCode {
  slot: number;
  pin: string;
  matchesUser?: { id: string; name: string; assignedSlot: number };
  assignedUser?: { id: string; name: string };
}
interface DriftReport { userRows: UserRow[]; lockCodes: LockCode[]; }
```

- **userRows** — one per *enabled* user:
  - `in_place`: lock slot at `user.slot` is enabled with matching fingerprint.
  - `wrong_slot` (`foundInSlot`): user's fingerprint matches an enabled slot at a
    different number.
  - `absent`: user's fingerprint matches no enabled slot.
- **lockCodes** — each enabled lock slot that is NOT an assigned user's in-place
  code: `{ slot, pin, matchesUser?, assignedUser? }`.
  - `matchesUser`: user whose fingerprint equals this slot's.
  - `assignedUser`: user whose `slot` equals this slot number (⇒ adopt would
    conflict; drives the Replace / free-slot resolution).

Disabled users are excluded from `userRows` (they expect no code); a disabled
user's PIN still on the lock surfaces as a `lockCode`. (Out of scope: dedicated
cleanup UI for that.)

### 2. View — rewrite `src/http/views/drift.ts` to render the report

- **Your users**: every enabled user with a status badge.
  - `wrong_slot` → **[Move to slot X]** (re-assign user, no lock write) +
    **[Rewrite slot N]** (clear drift + reconcile → writes when live).
  - `absent` → note "will be written when not read-only".
  - `in_place` → ✓, no action.
- **Codes on the lock**: each `lockCode`.
  - `assignedUser` present → conflict: **[Replace <name>'s PIN]** +
    **[Adopt to free slot]**, annotated "slot assigned to <name>".
  - else → **[Adopt]**.
  - annotate `matchesUser` ("matches <name>'s PIN, slot Y").
- Keep the existing global **Force resync** action.

### 3. Routes — `src/http/routes/locks.ts`

- `POST …/drift/adopt` (existing): wrap `addUser` in try/catch; on "already
  taken" redirect back with an error flag (safety net — the new UI won't normally
  offer plain Adopt for an occupied slot).
- `POST …/drift/replace` `{slot}`: find the user assigned to `slot` (400 if none);
  `updateUser(user.id, { pin: lockPin })`; bind cache slot to user + clear drift.
- `POST …/drift/adopt-free` `{slot}`: validate a drifted enabled slot with a
  known PIN; `addUser({ name, pin: lockPin })` (auto-allocated slot).
- `POST …/drift/move` `{userId, toSlot}`: guard `toSlot` in range and free of an
  assigned user; `updateUser(userId, { slot: toSlot })`.
- `POST …/drift/rewrite` `{slot}`: clear drift on the user's slot(s) + queue a
  reconcile (reuse the existing clear + reconcile path).

No new `Store` methods: `addUser` (auto-slot) and `updateUser` (pin/slot) suffice.
The `move` route guards slot conflicts itself (store `updateUser` does not).

### 4. Testing (TDD)

- **Unit** `buildDriftReport`: in_place; wrong_slot with `foundInSlot`; absent;
  unknown code in a free slot; foreign code in an assigned slot (`assignedUser`
  set); code matching a user in a different slot (`matchesUser` set).
- **Routes**: adopt conflict returns a redirect/message (no 500); replace updates
  the PIN and clears drift; adopt-free creates a user in a free slot; move
  re-assigns; guards reject bad slot / missing assigned user.

## Out of scope

- Slot-conflict guard inside `store.updateUser` (the move route guards instead).
- Dedicated UI to clean up a disabled user's leftover code (surfaces as a
  `lockCode`, adoptable/ignorable).
