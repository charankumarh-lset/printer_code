#!/usr/bin/env bash
# Install the local print agent as a boot service on a Linux kiosk
# (Raspberry Pi OS, Jetson / Ubuntu, Debian). Safe to re-run to upgrade.
#
#   sudo ./install-linux.sh            # port 9123
#   sudo PORT=9200 ./install-linux.sh
#
# Afterwards: open http://127.0.0.1:9123 on the kiosk to see the detected
# printer and print a test page. Optional overrides: /etc/printer-agent/printers.json
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-9123}"

[ "$(uname -s)" = Linux ] || { echo "This is the Linux installer. On macOS run ./install-macos.sh (no sudo)." >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -f "$HERE/printer-agent.js" ] || { echo "printer-agent.js must be next to this script (npm run bundle)." >&2; exit 1; }

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# Node 18+: distro package first (Pi OS bookworm ships 18), else NodeSource 20 (old Jetson Ubuntu).
if [ "$(node_major)" -lt 18 ]; then
  apt-get update -qq && apt-get install -y -qq nodejs || true
fi
if [ "$(node_major)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
NODE="$(command -v node)"
echo "Using Node $("$NODE" -v) at $NODE"

# USB printers appear as /dev/usb/lp* through the usblp kernel module.
modprobe usblp 2>/dev/null || true
install -d /etc/modules-load.d
echo usblp > /etc/modules-load.d/printer-agent.conf

install -d /opt/printer-agent /etc/printer-agent
install -m 0644 "$HERE/printer-agent.js" /opt/printer-agent/printer-agent.js
[ -f /etc/printer-agent/printers.json ] || echo '{ "printers": {} }' > /etc/printer-agent/printers.json

cat > /etc/systemd/system/printer-agent.service <<EOF
[Unit]
Description=Local label printer agent (http://127.0.0.1:${PORT})
After=network.target

[Service]
ExecStart=${NODE} /opt/printer-agent/printer-agent.js agent --config /etc/printer-agent/printers.json --port ${PORT}
Restart=always
RestartSec=2
# Unprivileged throwaway user; the lp group grants /dev/usb/lp* access.
DynamicUser=yes
SupplementaryGroups=lp

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable printer-agent >/dev/null
systemctl restart printer-agent

for _ in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:${PORT}/status" 2>/dev/null; then
    echo; echo "Printer agent is running: http://127.0.0.1:${PORT}"
    exit 0
  fi
  sleep 1
done
echo "Agent did not answer yet — check: journalctl -u printer-agent -n 50" >&2
exit 1
