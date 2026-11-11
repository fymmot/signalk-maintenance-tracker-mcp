#!/usr/bin/env bash
#
# Deploy the signalk-maintenance-tracker-mcp plugin on a Raspberry Pi (or any
# Linux box running Signal K). Run this AFTER git cloning the repo onto the Pi,
# from inside the repo:
#
#   ./deploy.sh
#
# It will:
#   1. Build the plugin (npm install + tsc) and install it into the Signal K
#      config dir so the server picks it up.
#   2. Restart the Signal K service so the plugin loads.
#
# The MCP bridge is built into the plugin (no separate process): enable it and
# set an access token in the admin UI, then point a public HTTPS tunnel at its
# port. See DEPLOY.md.
#
# Configurable via environment variables (sane defaults shown):
#   SIGNALK_DIR=$HOME/.signalk           Signal K config dir (plugins live here)
#   SIGNALK_SERVICE=signalk              systemd unit name for the Signal K server
#
# Flags:
#   --no-restart      don't restart the Signal K service
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGNALK_DIR="${SIGNALK_DIR:-$HOME/.signalk}"
SIGNALK_SERVICE="${SIGNALK_SERVICE:-signalk}"

DO_RESTART=1
for arg in "$@"; do
  case "$arg" in
    --no-restart) DO_RESTART=0 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed."; }

service_exists() {
  systemctl list-unit-files 2>/dev/null | grep -q "^$1\.service" \
    || systemctl status "$1" >/dev/null 2>&1
}

need node
need npm

log "Building plugin in $REPO_DIR"
cd "$REPO_DIR"
npm install
npm run build

log "Installing plugin into $SIGNALK_DIR"
mkdir -p "$SIGNALK_DIR"
cd "$SIGNALK_DIR"
[ -f package.json ] || npm init -y >/dev/null 2>&1
# file: dependency => symlink, so a future `npm run build` in the repo is picked up.
npm install "$REPO_DIR"
cd "$REPO_DIR"

if [ "$DO_RESTART" -eq 1 ]; then
  if service_exists "$SIGNALK_SERVICE"; then
    log "Restarting Signal K ($SIGNALK_SERVICE)"
    sudo systemctl restart "$SIGNALK_SERVICE"
  else
    warn "Signal K service '$SIGNALK_SERVICE' not found."
    warn "Restart Signal K manually so the plugin loads (set SIGNALK_SERVICE to override)."
  fi
else
  warn "Skipping Signal K restart (--no-restart); restart it manually to load the plugin."
fi

log "Done."
cat <<SUMMARY

Next steps:
  - In the Signal K admin UI (Server -> Plugin Config), enable "Maintenance
    Tracker" and set the engine-hours path.
  - Under "MCP bridge", set an access token (a long random secret) to turn the
    bridge on. Then expose its port (default 8766) via a public HTTPS tunnel
    and add it as a Claude connector. See DEPLOY.md.
  - Optionally seed a starter boat:  SK_URL=http://127.0.0.1:3000 node scripts/seed.mjs

Logs:  sudo journalctl -u ${SIGNALK_SERVICE} -f
SUMMARY
