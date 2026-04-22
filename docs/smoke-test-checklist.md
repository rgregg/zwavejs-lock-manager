# Smoke test checklist

Run through this before releasing a build. Assumes the service is running against a real `zwave-js-server`, real locks, and a real Home Assistant.

## Z-Wave wire-format sanity check (first deployment only)

Our automated tests run against an in-process mock of `zwave-js-server` that enforces the protocol state machine (`set_api_schema` → `start_listening` → ready) and validates the shape of `node.set_value` commands for User Code CC. That catches most wire-format drift, **but does not run against a real server**. Before the first deployment to real hardware, verify:

- [ ] Point `locks.yaml` at your real `zwave-js-server` (`zwaveJs.url`)
- [ ] Start the service and inspect logs — no `schema_incompatible`, `schema_not_set`, or `not_listening` errors
- [ ] `/locks` shows the configured locks with reachable status (no persistent "Disconnected" banner)
- [ ] Your `zwave-js-server` schema version is ≥ 25 (we target v37, clamp down to the server's max; v25 is the floor)

If the handshake fails on startup, the log will name the error code. The most likely issue is a very old `zwave-js-server` (< v1.30) — upgrade it.

## Prereqs

- [ ] `docker compose up -d` succeeds
- [ ] `curl -f http://localhost:8080/healthz` returns `ok`
- [ ] UI loads at `/users`, `/locks`, `/events`

## First-run seed

- [ ] Fresh `/data` (no `state.json`)
- [ ] Start service; `/locks` shows each lock with "Last verify" populated within a minute
- [ ] `state.json` on disk contains a `slots` map per lock

## Add user

- [ ] Add user "Alice" / PIN "1234"
- [ ] `/locks` shows "Last reconcile: ok" on each lock within a few seconds
- [ ] Alice's code works on every physical lock
- [ ] Unlocking with Alice's code shows "Alice unlocked <Lock>" in `/events`
- [ ] `events.jsonl` contains a `type: "write", outcome: "ok"` entry per lock
- [ ] HA notification fires with the expected message

## Edit (rename + PIN change)

- [ ] Rename Alice → Allison (blank PIN field). Old PIN still works; name changes in events/notifications
- [ ] Change PIN to 5678 (name unchanged). Old PIN stops working; new PIN works on every lock

## Disable/enable

- [ ] Disable Allison → code stops working on every lock
- [ ] Enable Allison → code works again on every lock

## Delete

- [ ] Delete Allison → code stops working, slot is free for the next user

## Drift detection (the spec-critical path)

- [ ] Manually program a code at one lock's keypad (pick an unused slot like 10, PIN 9999)
- [ ] Click "Verify now" on that lock
- [ ] `/locks` shows a "⚠ Drift: 1 slot(s)" badge for that lock
- [ ] **`/events` shows no `type: "write"` entries for that lock** — the drift was NOT auto-healed
- [ ] Click "Accept desired (force resync)" → the keypad-set code is overwritten with what `users.json` says
- [ ] Drift badge clears on next verify

## Failure modes

- [ ] Stop HA → unlock still logged in `/events` with `type: "notification_failed"`; banner appears
- [ ] Stop zwave-js-server → banner appears; no writes attempted; service auto-reconnects when zwave returns
- [ ] Start container with invalid `locks.yaml` → `/users` shows the "Configuration error" page; `/healthz` still returns 200 (no crash-loop)
- [ ] Start container with no `LOCAL_SECRET` → same as above, error page mentions `LOCAL_SECRET`

## Battery discipline (passive checks)

- [ ] After the initial first-run verify, watch `events.jsonl` and `zwave-js-server` logs for ~30 minutes while idle. No `node.get_value` traffic should occur unless you manually click "Verify now"
- [ ] After a week of running, weekly scheduled verify should fire once per lock, staggered
