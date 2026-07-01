# ZWaveJS Lock Manager — Home Assistant Add-on

Synchronize PIN codes across multiple Z-Wave door locks and get a Home Assistant
notification whenever a lock is opened with a keypad code.

## Install

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**
2. Add `https://github.com/rgregg/zwavejs-lock-manager`
3. Refresh the store and install **ZWaveJS Lock Manager**
4. Open the **Configuration** tab and add your locks (see below)
5. Start the add-on and open it from the sidebar

## Configuration

| Option | Description |
| --- | --- |
| `read_only` | When `true` (default), no codes are written to your locks — safe for first launch. Flip to `false` to let the reconciler push codes. |
| `zwave_url` | Optional. Leave blank to auto-discover the **Z-Wave JS add-on**. Set it (e.g. `ws://piworker01.lan:3000`) to use an external/standalone zwave-js-server instead. |
| `notify_service` | Home Assistant notify service to call on unlock, e.g. `notify.family`. |
| `notify_category` | Optional category passed in the notification body (for ticker.notify). |
| `verify_interval_days` | How often each lock is read back to detect drift. |
| `verify_stagger_minutes` | Spread verifies across locks to avoid waking them all at once. |
| `log_level` | `trace`–`fatal` (default `info`). |
| `locks` | List of locks: `id`, `name`, `node_id` (Z-Wave node), optional `max_code_slots` (default 30). |

Example:

```yaml
read_only: true
notify_service: notify.family
verify_interval_days: 7
verify_stagger_minutes: 60
log_level: info
locks:
  - id: front-door
    name: Front Door
    node_id: 58
    max_code_slots: 30
```

## How it works

- The Z-Wave JS connection is **auto-discovered** from the Z-Wave JS add-on — no
  URL to configure. (Running a standalone zwave-js-server? Set `zwave_url`.)
- Notifications go through the Home Assistant Supervisor, so no long-lived token
  is needed.
- The UI is served through **Ingress** (behind Home Assistant authentication);
  open it from the sidebar.

See the [project README](https://github.com/rgregg/zwavejs-lock-manager) for the
design notes and standalone (docker-compose) deployment.
