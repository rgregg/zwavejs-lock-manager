# Changelog

## 0.2.0

First stable Home Assistant add-on release, consolidating the 0.1.x series.

- Runs as a Home Assistant add-on: install from a custom repository, Ingress UI
  behind Home Assistant auth, notifications through the Supervisor (no long-lived
  token required).
- Auto-detects the Z-Wave JS add-on by probing the standard hostnames
  (`core-zwave-js`, `a0d7b954-zwavejs2mqtt`); set `zwave_url` to override for an
  external/standalone server or non-default port.
- User-centric drift view: shows whether each user's PIN is in place, in a
  different slot, or absent, and resolves conflicts safely (Replace / Adopt to a
  free slot / Move) — no more errors when a slot is already in use. All drift
  actions are read-only safe.
- Read-only mode on by default for a safe first launch.

## 0.1.2

- Drift page reorganized around your users: each shows whether its PIN is in
  place, in a different slot (and where), or absent from the lock.
- Adopting a code whose slot is already used by a managed user no longer errors —
  choose Replace (repoint that user's PIN) or Adopt to a free slot. Wrong-slot
  users can be Moved to where their PIN actually is. All actions are read-only
  safe (they only change `users.json`).

## 0.1.1

- Fix Z-Wave auto-detection: add-ons cannot call the Supervisor discovery API
  (`GET /discovery` is restricted to Home Assistant Core), which made a blank
  `zwave_url` fail with a 401. The add-on now auto-detects by probing the
  standard Z-Wave JS add-on hostnames (`core-zwave-js`, `a0d7b954-zwavejs2mqtt`)
  on port 3000. Set `zwave_url` to override.

## 0.1.0 — initial add-on release

- Auto-detects the zwave-js-server from the Z-Wave JS add-on
  (or set `zwave_url` for an external/standalone server)
- Notifications via the Home Assistant Supervisor (no long-lived token required)
- Ingress UI behind Home Assistant authentication
- Read-only mode on by default for a safe first launch
