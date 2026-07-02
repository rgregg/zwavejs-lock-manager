# Changelog

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
