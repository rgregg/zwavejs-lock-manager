# zwavejs-lock-users

A small self-hosted service that keeps user PIN codes in sync across multiple Z-Wave door locks (via `zwave-js-server`) and fires named unlock notifications through Home Assistant.

See the design spec: `docs/superpowers/specs/2026-04-21-zwave-lock-sync-design.md`

## Quickstart

> For a first deployment against real hardware, follow `docs/deployment-guide.md` — it walks you through a read-only validation pass before enabling writes.

1. Copy `docs/example-locks.yaml` to `data/locks.yaml` and edit `zwaveJs.url`, your HA URL, and your locks.
2. Set env vars:
   - `HA_TOKEN` — long-lived HA access token
   - `LOCAL_SECRET` — any random string; used to fingerprint PINs
3. `docker compose -f docker-compose.example.yml up -d`
4. Visit `http://localhost:8080/users` to manage users.

## Config files (under `/data`)

- `locks.yaml` — hand-edited (locks, HA, zwavejs URLs)
- `users.json` — managed via the web UI
- `state.json` — app-managed cache of what's currently on each lock
- `events.jsonl` — append-only unlock/log stream

## Development

```
npm install
npm test
npm run dev
```

See `docs/smoke-test-checklist.md` for pre-release verification.
