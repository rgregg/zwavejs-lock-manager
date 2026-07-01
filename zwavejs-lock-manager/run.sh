#!/usr/bin/with-contenv bashio
# Note: no `set -euo pipefail` here. bashio's helpers are not written for `set -u`
# (they reference optional internals) and we don't want a transient Supervisor
# hiccup to abort startup — the Node app degrades gracefully on its own.

# /data/options.json is HA-managed. The Node loader auto-detects addon mode via
# SUPERVISOR_TOKEN and reads config + the HA connection from there.
export DATA_DIR=/data
export PORT=8080
export LOG_LEVEL="$(bashio::config 'log_level' 'info' 2>/dev/null || echo info)"

# Generate a stable per-install secret on first run. /data persists across add-on
# upgrades, so PIN fingerprints stay valid.
if [ ! -f /data/local_secret ]; then
  head -c 32 /dev/urandom | xxd -p | tr -d '\n' > /data/local_secret
fi
export LOCAL_SECRET="$(cat /data/local_secret)"

bashio::log.info "Starting zwavejs-lock-manager (addon mode)" || true
exec node /app/dist/index.js
