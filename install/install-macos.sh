#!/usr/bin/env bash
# Install the local print agent on macOS as a LaunchAgent for the logged-in
# user: starts at login, restarts if it crashes. Safe to re-run to upgrade.
#
#   ./install-macos.sh                 # port 9123 (no sudo)
#   PORT=9200 ./install-macos.sh
#   ./install-macos.sh --uninstall
#
# Printers: the agent adds any thermal USB printer you plug in (now or later) to
# CUPS by itself and prints through it. Network printers: add them to printers.json (tcp).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-9123}"
LABEL="com.antz.printer-agent"
DIR="$HOME/Library/Application Support/printer-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

[ "$(uname -s)" = Darwin ] || { echo "This is the macOS installer. On Linux run: sudo ./install-linux.sh" >&2; exit 1; }
[ "$(id -u)" -ne 0 ] || { echo "Run without sudo — it installs for the logged-in user." >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed. Config and log left in: $DIR"
  exit 0
fi

[ -f "$HERE/printer-agent.js" ] || { echo "printer-agent.js must be next to this script (npm run bundle)." >&2; exit 1; }
NODE="$(command -v node)" || { echo "Install Node 18+ first: brew install node (or https://nodejs.org)" >&2; exit 1; }
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Node 18+ required, found $("$NODE" -v)" >&2; exit 1; }
echo "Using Node $("$NODE" -v) at $NODE"

mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
cp "$HERE/printer-agent.js" "$DIR/printer-agent.js"
[ -f "$DIR/printers.json" ] || echo '{ "printers": {} }' > "$DIR/printers.json"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/printer-agent.js</string>
    <string>agent</string>
    <string>--config</string>
    <string>$DIR/printers.json</string>
    <string>--port</string>
    <string>$PORT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$DIR/agent.log</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

for _ in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:${PORT}/status" 2>/dev/null; then
    echo; echo "Printer agent is running: http://127.0.0.1:${PORT}"
    echo "Config: $DIR/printers.json   Log: $DIR/agent.log"
    exit 0
  fi
  sleep 1
done
echo "Agent did not answer yet — check: $DIR/agent.log" >&2
exit 1
