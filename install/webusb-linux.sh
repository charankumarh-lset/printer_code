#!/usr/bin/env bash
# ONLY for kiosks that print with WebUSB (browser → USB) instead of the agent.
# Lets Chrome open USB printers on Linux:
#   1. udev rule so the browser user may open printer-class USB devices
#   2. stops the kernel usblp driver, which otherwise holds the printer
# Side effect: /dev/usb/lp* disappears, so the agent's USB auto-detect stops
# working on this device. Pick one path per kiosk. Undo: delete both files, reboot.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }

cat > /etc/udev/rules.d/60-webusb-printers.rules <<'EOF'
SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ENV{ID_USB_INTERFACES}=="*:0701*", MODE="0666"
EOF
echo "blacklist usblp" > /etc/modprobe.d/webusb-no-usblp.conf
rm -f /etc/modules-load.d/printer-agent.conf
rmmod usblp 2>/dev/null || true
udevadm control --reload-rules
udevadm trigger
echo "Done. Re-plug the printer, then print from the kiosk page."
