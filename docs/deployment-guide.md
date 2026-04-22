# Deployment guide

Step-by-step for deploying zwavejs-lock-users against your real `zwave-js-server` and Home Assistant. We do it in two phases so you can validate safely.

## Prereqs

- A running `zwave-js-server` instance reachable from where you'll run this container. Common setups:
  - HA add-on "Z-Wave JS UI" or "zwave-js-server" — exposes WebSocket on port 3000.
  - Standalone Docker container.
- A Home Assistant instance with a long-lived access token (Settings → Profile → Long-lived access tokens).
- Your locks already included in the Z-Wave network; note each lock's **node ID** (visible in Z-Wave JS UI or in HA's device page).

## Phase 1 — read-only validation

### 1. Create `data/locks.yaml`

Copy `docs/example-locks.yaml` to `data/locks.yaml` and edit:

```yaml
zwaveJs:
  url: ws://<your-zwavejs-host>:3000

homeAssistant:
  url: http://<ha-host>:8123
  token: ${HA_TOKEN}
  notify:
    service: notify.<your_mobile_app>

verify:
  intervalDays: 7
  staggerMinutes: 60

readOnly: true   # <<< important for phase 1

locks:
  - id: front-door
    name: Front Door
    nodeId: 7          # replace with your real node id
    maxCodeSlots: 30
  # add more locks as needed
```

### 2. Set env vars

Create `.env`:

```
HA_TOKEN=eyJ...your-ha-long-lived-token...
LOCAL_SECRET=<generate-a-random-string>
```

Generate `LOCAL_SECRET` with `openssl rand -hex 32` or similar. Keep it — if you lose it, next verify will re-fingerprint everything (harmless in read-only mode).

### 3. Start the container

```
docker compose -f docker-compose.example.yml --env-file .env up -d
```

(Or adapt the compose file to your setup.)

### 4. Validate

Visit `http://localhost:8080/users`. Expect:

- Banner: **🔒 READ ONLY mode — no codes will be written to your locks.**
- `/locks` page: each lock shown with "Last verify" populated within a minute. No "Last reconcile" (none should run in read-only).
- Container logs: `"READ ONLY mode — no writes will be issued"` at startup; no `setUserCode` / `clearUserCode` calls should appear.

### 5. Try a real unlock

Walk up to a lock and enter a keypad code that's already programmed on the lock (one you set manually or via your existing HA flow). Expect:

- `/events` page shows the unlock within a few seconds — either "Alice unlocked Front Door" if the slot matches a user you've added in the UI, or "Unknown user (slot N) unlocked Front Door" otherwise.
- Your HA notification fires with the same message.

If the unlock event doesn't appear, check the logs for handshake errors (`schema_incompatible`, `not_listening`). Upgrade zwave-js-server if its `maxSchemaVersion` is below 25.

### 6. Add a test user (still read-only)

In `/users`, add "Alice" with a test PIN. Expect:

- User appears in the list with slot assignment.
- Logs show `"[READ ONLY] blocked setUserCode"` — no write to the lock.
- No changes to physical lock behavior.

This confirms the full add-user flow works; only the final write step is gated.

## Phase 2 — live writes

Once phase 1 is clean:

1. Edit `data/locks.yaml`: change `readOnly: true` → `readOnly: false`.
2. `docker compose restart zwavejs-lock-users`.
3. Add a user in the UI. Within seconds, the code should work on every lock.
4. Walk through the full smoke checklist (`docs/smoke-test-checklist.md`).

## Rollback

If anything misbehaves in phase 2, flip back to `readOnly: true` and restart. The cache file (`state.json`) is preserved. No writes mean no damage.
