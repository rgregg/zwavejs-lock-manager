# Z-Wave Lock User Sync — Design

- **Date**: 2026-04-21
- **Status**: Approved for planning

## Overview

A self-hosted web service that keeps user PIN codes synchronized across multiple Z-Wave door locks (driven by `zwave-js-server`) and delivers named unlock notifications via Home Assistant.

The user manages people and PINs in a small web UI; the service reconciles each lock to match the desired state with the minimum possible radio traffic. When a known code is entered at a lock, the service resolves the slot to a user and fires a notification through Home Assistant's notify service.

### Primary goals

- Single source of truth for "who has a code and what it is," enforced across every lock.
- Add, edit, disable, and delete users without manually touching each lock.
- Named unlock notifications: "Alice unlocked Front Door."
- Minimize battery impact: no polling, no speculative reads, writes only when state needs to change.

### Non-goals for v1

- Multi-admin / per-user permissions for the web UI.
- Temporary or time-windowed codes, scheduled access, code rotation.
- Multi-hub / multiple `zwave-js-server` instances.
- Encrypted-at-rest user data.
- Notification providers other than Home Assistant.
- E2E browser tests.

## Runtime shape

- Single Node.js + TypeScript process.
- Packaged as a Docker image. Runs alongside an existing `zwave-js-server` and a Home Assistant instance reachable on the network.
- Binds to the trusted LAN with no built-in authentication. Intended to sit behind a reverse proxy / on a private network.
- Persists state to a mounted `/data` volume.

## Architecture

```
                  ┌─────────────────────────────┐
                  │          Web UI             │
                  │   (HTMX + server-rendered)  │
                  └─────────────┬───────────────┘
                                │ HTTP + SSE
                  ┌─────────────▼───────────────┐
                  │    HTTP server (Fastify)    │
                  │  /users, /locks, /events    │
                  └──────┬────────────┬─────────┘
                         │            │
           ┌─────────────▼─┐      ┌───▼──────────┐
           │   Store       │      │ Reconciler   │
           │ users.json,   │◄────►│ desired vs.  │
           │ locks.yaml    │      │ cache diff   │
           └───────┬───────┘      └──┬───────┬───┘
                   │ desired         │       │ writes only
                   │                 │       │
                   │       ┌─────────▼───┐   │
                   └──────►│ LockState   │◄──┘
                           │ Cache       │
                           │ (persisted) │
                           └──────▲──────┘
                                  │ push events only
                           ┌──────┴───────┐
                           │ ZWaveJSClient │
                           └──────┬────────┘
                                  │
                           ┌──────▼──────┐
                           │  EventBus   │
                           └──┬────┬─────┘
                              │    │
                ┌─────────────▼┐  ┌▼──────────┐
                │  Notifier    │  │ Event Log │
                │ (HA notify)  │  │ events.jsonl│
                └──────────────┘  └───────────┘
```

### Components

- **Store** — reads/writes `locks.yaml` (hand-edited) and `users.json` (UI-managed). Emits change events. No knowledge of Z-Wave or Home Assistant.
- **LockStateCache** — the app's belief about what each lock currently holds in each slot. Persisted to `state.json`. Updated only from (a) successful writes we issued, (b) events pushed by `zwave-js-server`, (c) explicit user-initiated verify. Never a speculative read.
- **Reconciler** — diffs desired state (from Store) against cached actual state (from LockStateCache) and issues only the required writes. Per-lock serialized, cross-lock parallel, debounced.
- **ZWaveJSClient** — wraps the `zwave-js-server` WebSocket. Exposes `setUserCode`, `clearUserCode`, `getAllUserCodes` (used only for verify), and a subscription for unlock notifications and keypad-triggered code changes. All Z-Wave protocol knowledge is contained here.
- **EventBus** — in-process pub/sub. Decouples event sources from consumers.
- **Notifier** — calls Home Assistant's REST API to invoke the configured `notify.*` service. Resolves slot → user name via the Store. Fires on both known and unknown slot unlocks (different message).
- **HTTP server (Fastify)** — thin layer over the Store and Reconciler. Returns server-rendered HTML + HTMX partials. Exposes an SSE stream of events.
- **Web UI** — server-rendered HTML with HTMX for partial updates. No separate frontend build pipeline.

### Boundary rationale

Z-Wave knowledge lives in exactly one place (`ZWaveJSClient`), Home Assistant knowledge in one place (`Notifier`), and the Store knows nothing about either. The Reconciler is testable with a fake cache and fake client. The ZWaveJSClient is testable against a stub WebSocket.

## Data model

All paths are under the `/data` mount.

### `locks.yaml` — hand-edited configuration

```yaml
zwaveJs:
  url: ws://zwavejs:3000

homeAssistant:
  url: http://homeassistant.local:8123
  token: ${HA_TOKEN}
  notify:
    service: notify.mobile_app_ryan

verify:
  intervalDays: 7
  staggerMinutes: 60

locks:
  - id: front-door # stable internal id; never changes
    name: Front Door # display name; used in notifications
    nodeId: 7
    maxCodeSlots: 30
  - id: back-door
    name: Back Door
    nodeId: 9
    maxCodeSlots: 30
```

### `users.json` — UI-managed

```json
{
  "version": 1,
  "users": [
    {
      "id": "u_01HZ…",
      "name": "Alice",
      "pin": "123456",
      "enabled": true,
      "slot": 3,
      "createdAt": "2026-04-21T…",
      "updatedAt": "2026-04-21T…"
    }
  ]
}
```

- `id` is a ULID assigned at creation, immutable.
- `pin` is stored plaintext; rationale below.
- `slot` is global across all locks; see Slot allocation.
- Only the Store writes this file; writes are atomic (`*.tmp` + `fsync` + rename).

### `state.json` — LockStateCache (app-managed)

```json
{
  "version": 1,
  "locks": {
    "front-door": {
      "lastVerifiedAt": "2026-04-14T…",
      "lastReconcileAt": "2026-04-21T…",
      "lastReconcileOutcome": "ok",
      "slots": {
        "3": {
          "status": "enabled",
          "userId": "u_01HZ…",
          "pinFingerprint": "sha256:…",
          "updatedAt": "…"
        },
        "4": { "status": "empty", "updatedAt": "…" },
        "5": { "status": "unknown" }
      }
    }
  }
}
```

- `status` is one of `enabled`, `empty`, `unknown`.
- `pinFingerprint = HMAC-SHA256(LOCAL_SECRET, pin)`. Detects drift without storing plaintext.
- Slots not present in the map are treated as `unknown`.

### `events.jsonl` — append-only event log

One JSON object per line. Used for the unlock log UI and diagnostics.

```
{"ts":"…","type":"unlock","lockId":"front-door","userId":"u_…","userName":"Alice","slot":3}
{"ts":"…","type":"unlock","lockId":"front-door","slot":7}
{"ts":"…","type":"write","lockId":"front-door","slot":3,"outcome":"ok"}
{"ts":"…","type":"keypad_change","lockId":"front-door","slot":5}
{"ts":"…","type":"notification_failed","reason":"ha_unreachable","lockId":"front-door","slot":3}
```

Retention: 90 days by default. Size-based rotation at ~10 MB.

### Design calls baked in

- **Same slot across every lock for a given user.** Makes unlock-event → user resolution trivial and keeps the mental model simple. Upper bound is the smallest `maxCodeSlots`.
- **Plaintext PIN in `users.json`.** Needed to write to newly added locks, re-enable a disabled user, or repair drift. Mitigated with file perms (`0600`) and non-root container user.
- **HMAC fingerprint in `state.json`.** Avoids duplicating the plaintext PIN in a second file and lets verify detect drift. `LOCAL_SECRET` is an env var.

## Reconciliation

### Slot allocation

- On user creation, the Store picks the lowest integer in `[1, min(lock.maxCodeSlots)]` not already assigned to another user (enabled or disabled).
- Disabled users keep their slot reserved so re-enabling doesn't reshuffle.
- Deletion frees the slot for reuse.
- No repacking of existing users.

### Trigger conditions

- Any mutation to `users.json`.
- Startup, if desired state ≠ cache.
- Lock newly present in `locks.yaml` (after first-run verify completes).
- Manual "Resync" click in the UI.

Scheduled polling is **not** a trigger.

### Write path by action

| User action           | Radio writes                                                  | Rationale                            |
| --------------------- | ------------------------------------------------------------- | ------------------------------------ |
| Create user           | `setUserCode(slot, pin)` on every lock                        | New slot occupant everywhere         |
| Rename user           | none                                                          | Name isn't stored on the lock        |
| Change PIN            | `setUserCode(slot, newPin)` on every lock                     | Fingerprint differs from cache       |
| Disable user          | `clearUserCode(slot)` on every lock                           | Remove from lock; keep slot reserved |
| Enable user           | `setUserCode(slot, pin)` on every lock                        | Repopulate                           |
| Delete user           | `clearUserCode(slot)` on every lock; remove from `users.json` | Free the slot                        |
| Add lock (restart)    | first-run verify, then fill-in reconcile                      | Build cache, then apply desired      |
| Remove lock (restart) | none                                                          | Out of reach; drop cache entry       |

### Execution rules

- **Per-lock serialization.** Writes to a single node flow through a FIFO queue.
- **Cross-lock parallel.** Different nodes are independent.
- **Debounce.** Rapid mutations coalesce into one reconcile per lock within a ~500 ms window.
- **Retry.** Up to 2 retries with backoff; then mark `lastReconcileOutcome: "error"` and surface a Retry button in the UI. No unbounded retries.

## Verify

Verify is the only operation besides writes that causes radio traffic. It is the exception, not the rule.

- **First-run.** Any lock with no cache entry triggers a full slot read (`1..maxCodeSlots`). The result seeds the cache.
- **Scheduled.** Every `verify.intervalDays` per lock, staggered across `verify.staggerMinutes` so multiple locks don't wake simultaneously.
- **Manual.** UI "Verify now" button with a warning that it wakes the lock.

Drift discovered by verify is **flagged in the UI, not auto-healed.** Someone may have intentionally set a code at the keypad; auto-writing would silently clobber that.

## Unlock event flow

1. `zwave-js-server` pushes a Notification CC event (node id + slot / userId).
2. `ZWaveJSClient` normalizes and publishes to the EventBus.
3. Three independent subscribers:
   - **Notifier** — resolves slot → user. Fires HA notify service with "Alice unlocked Front Door" or "Unknown user (slot 7) unlocked Front Door". Unknown-slot unlocks are still notified; silent failures are worse than noisy ones for a security event.
   - **Event log writer** — appends to `events.jsonl`.
   - **SSE broadcaster** — pushes to any open UI clients.

Keypad-triggered code changes observed on the same WebSocket (if exposed by the driver) update the cache's `status` to `unknown` for that slot and are logged, so the user sees drift at the next verify.

## Startup sequence

1. Load `locks.yaml`, `users.json`, `state.json`. Validate config; on fatal config errors, start anyway and surface a "Configuration error" UI page (don't crash-loop).
2. Connect to `zwave-js-server` with exponential backoff (1 s → 30 s cap).
3. Subscribe to notifications for all configured node IDs.
4. For every lock with no cache entry, schedule a first-run verify.
5. After first-run verifies complete (or immediately for locks that already have a cache), compute desired-vs-cache diff and reconcile.
6. Schedule weekly verify per lock, staggered.

## Error handling

| Failure                             | Behavior                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `zwave-js-server` disconnected      | Auto-reconnect (1 s → 30 s backoff). UI banner. Write queue dropped on disconnect and recomputed on reconnect.                     |
| Node dead / unreachable             | 2 retries, then `lastReconcileOutcome: "error"` for that lock. Other locks unaffected.                                             |
| HA unreachable for notifications    | Log; append `notification_failed` entry to `events.jsonl`; no retry (stale security alerts are worse than missed ones). UI banner. |
| Atomic file write fails             | Return a clear error to the UI. Never leave a partial file.                                                                        |
| Invalid `locks.yaml`                | Service starts, UI shows "Configuration error" page with specifics.                                                                |
| Missing `HA_TOKEN` / `LOCAL_SECRET` | Service starts, UI disables notifications / fingerprinting respectively and flags the condition.                                   |

## Observability

- **Structured logs** to stdout via `pino`. PINs are redacted at source.
- **`/healthz`** returns 200 when the process is up. Does not depend on `zwave-js-server` or HA reachability — orchestrators shouldn't restart the container because HA is down.
- **UI status surface**: per-lock last reconcile time / outcome, ZWaveJS and HA connection indicators, tail of the event log.

## Testing

- **Unit tests**: `Store` (file IO + atomic writes + slot allocation), `Reconciler` (diff logic with fake cache + fake client), `LockStateCache` (merge rules), `Notifier` (payload shape with fake HA client).
- **Integration tests**: an in-process mock `zwave-js-server` that records commands and replays events. Exercises startup, first-run verify, reconcile-on-change, and unlock event propagation. No real hardware in CI.
- **Manual smoke checklist** in `docs/`: first-run seed, add user, change PIN, disable/enable, delete user, verify detects keypad-set code, HA notification end-to-end. Run once before release.
- **No E2E browser tests** for v1. HTMX + server-rendered forms keep UI logic thin enough that Fastify route tests plus the smoke checklist suffice.

## Deployment

- **Image**: Node 22 Alpine multi-stage build, non-root user, `0600` on data files at first boot.
- **Volume**: `/data` containing `locks.yaml`, `users.json`, `state.json`, `events.jsonl`.
- **Env vars**:
  - `HA_TOKEN` (required for notifications)
  - `LOCAL_SECRET` (required for HMAC fingerprinting)
  - `PORT` (default `8080`)
  - `LOG_LEVEL` (default `info`)
- **`docker-compose.yml`** example shipped in the repo showing the service alongside `zwave-js-server` and pointed at the HA URL.

## Security notes

- No authentication on the web UI. Intended deployment is trusted LAN or behind a reverse proxy that handles auth.
- PINs are plaintext on disk; protect the host and volume accordingly.
- `LOCAL_SECRET` should be unique per deployment. Losing it means the next verify will re-establish fingerprints; no data is lost.

## Battery-preservation rule (summary)

The single rule that the implementation must honor: **the only radio-traffic causes are (a) writes required to converge cache to desired, (b) verify — first-run, weekly scheduled, or manually triggered. No other reads. No polling.**
