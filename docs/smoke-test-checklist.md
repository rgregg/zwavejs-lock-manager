# Smoke test checklist

Run through this before releasing a build. Assumes the service is running against real locks and a real Home Assistant.

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
- [ ] HA notification fires with the expected message

## Change PIN

- [ ] Delete "Alice", re-add as "Alice" / PIN "5678"
- [ ] Old PIN no longer works; new PIN works on every lock

## Disable/enable

- [ ] Disable Alice → code stops working on every lock
- [ ] Enable Alice → code works again on every lock

## Delete

- [ ] Delete Alice → code stops working, slot is free for the next user

## Drift detection

- [ ] Manually program a code at one lock's keypad (slot 10)
- [ ] Click "Verify now" on that lock
- [ ] `/locks` / `state.json` reflects the new code in slot 10 with `status: enabled`
- [ ] No auto-writes were issued to fix the drift

## Failure modes

- [ ] Stop HA → unlock still logged in `/events` with "notification_failed"
- [ ] Stop zwave-js-server → `/locks` shows connection error; service auto-reconnects when zwave is back
