# Deploying on a Raspberry Pi

Most users can install straight from the Signal K **Appstore** (see the README).
Use this guide to run from a git checkout, e.g. on a Raspberry Pi.

The MCP bridge is **built into the plugin** — there's no separate process, venv, or
systemd unit to manage. You enable it and set an access token in the admin UI, then
expose its port through a tunnel.

## Prerequisites

- **Node.js + npm** (already present if Signal K runs there).
- A working **Signal K server** as a systemd service (default unit `signalk`). The
  plugin's data lives under the Signal K config dir (default `~/.signalk`).
- `sudo` rights (for restarting Signal K).

## Quick start

```bash
git clone https://github.com/fymmot/signalk-maintenance-tracker-mcp.git ~/signalk-maintenance-tracker-mcp
cd ~/signalk-maintenance-tracker-mcp
./deploy.sh
```

`deploy.sh` builds and installs the plugin and restarts Signal K. It's idempotent —
re-run it after pulling updates. Overrides:

```bash
# Different Signal K dir or service name (e.g. OpenPlotter)
SIGNALK_DIR=/home/pi/.signalk SIGNALK_SERVICE=signalk ./deploy.sh

# Build and install but don't restart
./deploy.sh --no-restart
```

## After deploy.sh

1. **Enable the plugin.** Admin UI → *Server → Plugin Config* → **Maintenance
   Tracker**, enable it, and set the **engine-hours path** (your engine-hours tracker
   plugin's all-time count). Optionally set a **git remote URL** for off-SD backup.

2. **Turn on the MCP bridge.** In the same config page, under **MCP bridge**, set an
   **Access token** (a long random secret). The bridge starts on its **port** (default
   8766). Optionally set a **URL secret** for Claude web connectors and an **allowed
   hosts** list.

3. **Expose the bridge through a public HTTPS tunnel** (required for Claude). The
   bridge listens on `localhost:<port>`, so Claude's remote connectors can't reach it
   directly. A
   [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
   is the easiest (ngrok or a reverse proxy also work). Route your public URL to
   `http://localhost:8766`, then add it in Claude as a connector with
   `Authorization: Bearer <access token>` (or `https://<your-host>/mcp/<url-secret>`
   for Claude web).

4. **Seed a starter boat** (optional):
   ```bash
   SK_URL=http://127.0.0.1:3000 node scripts/seed.mjs --dry-run   # preview
   SK_URL=http://127.0.0.1:3000 node scripts/seed.mjs             # create
   ```

## Verifying

```bash
# Plugin REST API is up (through Signal K):
curl http://127.0.0.1:3000/plugins/signalk-maintenance-tracker-mcp/due

# MCP bridge rejects an unauthenticated request (expect 401):
curl -so /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8766/mcp

# Logs:
sudo journalctl -u signalk -f
```

The plugin's status line shows `MCP on :8766` when the bridge is running (or a hint if
it's enabled without a token).

## Updating

```bash
cd ~/signalk-maintenance-tracker-mcp && git pull && ./deploy.sh
```

Because the plugin installs as a `file:` dependency (a symlink), a plain
`npm run build` in the repo updates the code Signal K runs; restart Signal K to reload.

## Manual steps

```bash
cd ~/signalk-maintenance-tracker-mcp
npm install
npm run build
cd ~/.signalk
npm install ~/signalk-maintenance-tracker-mcp
sudo systemctl restart signalk
```

Signal K discovers the plugin via the `signalk-node-server-plugin` keyword in
`package.json`.

## Uninstall

```bash
cd ~/.signalk && npm uninstall signalk-maintenance-tracker-mcp
sudo systemctl restart signalk
```

Your maintenance data in `~/.signalk/plugin-config-data/signalk-maintenance-tracker-mcp`
(a git repo) is left untouched; delete it manually if you want it gone.

## Notes

- **Data location & backup.** The datastore is a git repo at
  `~/.signalk/plugin-config-data/signalk-maintenance-tracker-mcp`. Set a git remote in the
  plugin config for automatic off-SD backup via background `git push`.
- **OpenPlotter.** If Signal K runs under a different service name or config dir, pass
  `SIGNALK_SERVICE=` / `SIGNALK_DIR=` to `deploy.sh`.
