# zwavejs-lock-manager

[![CI](https://github.com/rgregg/zwavejs-lock-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/rgregg/zwavejs-lock-manager/actions/workflows/ci.yml)
[![ghcr.io](https://img.shields.io/badge/ghcr.io-rgregg%2Fzwavejs--lock--manager-blue)](https://github.com/rgregg/zwavejs-lock-manager/pkgs/container/zwavejs-lock-manager)

A small self-hosted service that keeps user PIN codes in sync across multiple Z-Wave door locks (via `zwave-js-server`) and fires named unlock notifications through Home Assistant.

## What it does

- One web UI to manage who has a code on which slot, across every lock.
- Reads existing codes off your locks (live, not from cache) and lets you adopt them as managed users.
- Detects drift between your `users.json` and what's actually programmed on each lock — never silently overwrites a keypad-set code.
- Fires HA notifications by name when someone unlocks (`<Name> unlocked Front Door`).
- Read-only mode for safe first-deployment validation.

See `docs/superpowers/specs/2026-04-21-zwave-lock-sync-design.md` for the design.

## Quickstart

> First deployment? Walk through `docs/deployment-guide.md` — it covers a read-only validation pass before enabling writes.

1. Copy `docs/example-locks.yaml` to `data/locks.yaml` and edit:
   - `zwaveJs.url` — your `zwave-js-server` WebSocket
   - `homeAssistant.url` and `notify.service`
   - `locks:` — your locks (find each `nodeId` in Z-Wave JS UI or via HA's device page)
2. Create `.env`:
   - `HA_TOKEN` — long-lived HA access token (Settings → Profile → Long-Lived Access Tokens)
   - `LOCAL_SECRET` — any random string (`openssl rand -hex 32`); used to fingerprint PINs
3. `docker compose -f docker-compose.example.yml --env-file .env up -d`
4. Open `http://<host>:8080/users`

### Pulling pre-built images

Images are published to GHCR for `linux/amd64` and `linux/arm64`:

```
docker pull ghcr.io/rgregg/zwavejs-lock-manager:latest      # tracks main
docker pull ghcr.io/rgregg/zwavejs-lock-manager:1           # latest 1.x release
docker pull ghcr.io/rgregg/zwavejs-lock-manager:1.2         # latest 1.2.x release
docker pull ghcr.io/rgregg/zwavejs-lock-manager:1.2.3       # specific release
```

## Config files (under `/data`)

- `locks.yaml` — hand-edited (locks, HA, zwavejs URLs, `readOnly` flag)
- `users.json` — managed via the web UI
- `state.json` — app-managed cache of what's currently on each lock
- `events.jsonl` — append-only unlock/write log

## Drift detection

`zwavejs-lock-manager` never auto-overwrites codes set at the keypad. When a verify finds a slot whose PIN doesn't match `users.json`, it flags drift and surfaces it in the UI. From `/locks/<id>/drift`, choose per-slot:

- **Adopt** — turn the lock's existing code into a new managed user (no write).
- **Force resync** — push `users.json`'s desired state to the lock (overwrites the keypad-set code).

## Development

```bash
npm install
npm test         # 138+ unit + integration tests
npm run dev      # live-reload via tsx
```

`docs/smoke-test-checklist.md` covers manual pre-release verification.

## Roadmap

- Home Assistant add-on packaging — see `docs/superpowers/plans/2026-04-26-home-assistant-addon.md`.

## License

MIT (see LICENSE).
