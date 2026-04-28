#!/usr/bin/with-contenv bashio
set -euo pipefail

# Provide the supervisor token to the Node app for HA REST calls.
export HA_TOKEN="${SUPERVISOR_TOKEN:-}"

# /data/options.json is HA-managed. Loader auto-detects addon mode via SUPERVISOR_TOKEN.
export DATA_DIR=/data
export PORT=8080
export LOG_LEVEL="$(bashio::config 'log_level' 'info')"

# Generate a stable LOCAL_SECRET if missing (HA add-on persists /data across upgrades).
if [ ! -f /data/local_secret ]; then
  head -c 32 /dev/urandom | xxd -p > /data/local_secret
fi
export LOCAL_SECRET="$(cat /data/local_secret)"

bashio::log.info "Starting zwavejs-lock-users (addon mode)"
exec node /app/dist/index.js
