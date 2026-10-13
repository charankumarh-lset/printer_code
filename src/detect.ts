import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

import type { PrinterConfig } from './types';
import { guessDriver, isKnownThermal, parseDeviceId } from './vendors';

export interface DetectedPrinter {
  name: string;
  description: string;
  config: PrinterConfig;
}

/**
 * Find locally attached printers with no setup:
 * - Linux (Pi, Jetson): USB printers the kernel exposes as /dev/usb/lp*
 * - macOS: newly plugged-in USB thermal printers are first added to CUPS
 * - Linux/macOS: USB queues in CUPS that look like thermal printers
 *   (office printers are skipped so they never receive raw thermal bytes)
 * Windows has no driverless raw path; configure a `spooler` printer there.
 */
export function detectPrinters(): DetectedPrinter[] {
  const found: DetectedPrinter[] = [];
  if (process.platform === 'linux') found.push(...linuxUsbLp());
  if (process.platform === 'darwin') addMacUsbPrinters();
  if (process.platform !== 'win32') found.push(...cupsUsbQueues());
  return found;
}

const GENERIC_PPD =
  '/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/PrintCore.framework/Versions/A/Resources/Generic.ppd';
const USB_SCAN_INTERVAL_MS = 5000;

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, LANG: 'C' },
  });
}

/**
 * USB printers CUPS can see, URI → IEEE 1284 device ID, from `lpinfo -l -v`:
 *   Device: uri = usb://Seznik/B15?serial=1
 *           device-id = MFG:Seznik ;CMD:TSPL ;MDL:B15 ;
 */
export function parseLpinfoDevices(output: string): Map<string, string> {
  const devices = new Map<string, string>();
  let uri: string | undefined;
  for (const line of output.split('\n')) {
    const u = /^Device:\s*uri\s*=\s*(usb:\/\/\S+)/.exec(line.trim());
    if (u) {
      uri = u[1];
      devices.set(uri, '');
      continue;
    }
    const id = /^device-id\s*=\s*(.*)$/.exec(line.trim());
    if (id && uri) devices.set(uri, id[1]);
  }
  return devices;
}

let usbIds: { at: number; listed: boolean; devices: Map<string, string> } = { at: 0, listed: false, devices: new Map() };

/**
 * USB device IDs, refreshed at most every 5 s (probes only the usb backend,
 * ~0.1 s). The device ID's command set (CMD:ESC/POS / ZPL / TSPL) is what
 * identifies a thermal printer and its language — whatever the brand. Empty
 * where listing devices needs admin rights (e.g. a Linux service user).
 */
function usbDeviceIds(): { listed: boolean; devices: Map<string, string> } {
  if (Date.now() - usbIds.at >= USB_SCAN_INTERVAL_MS) {
    try {
      usbIds = { at: Date.now(), listed: true, devices: parseLpinfoDevices(run('lpinfo', ['-l', '--include-schemes', 'usb', '-v'])) };
    } catch {
      // CUPS not available, or not allowed to list devices.
      usbIds = { at: Date.now(), listed: false, devices: new Map() };
    }
  }
  return usbIds;
}

const usbModel = (uri: string) => decodeURIComponent(uri.replace(/^usb:\/\/|\?.*$/g, '')).replace('/', ' ');

/**
 * macOS dropped raw CUPS queues, so a USB thermal printer isn't printable
 * until it has a queue. Add one with the generic driver — the spooler
 * transport prints with `lp -o raw`, which bypasses it per job. Needs an
 * admin user (member of _lpadmin); otherwise the printer must be added in
 * System Settings.
 */
function addMacUsbPrinters(): void {
  const { devices } = usbDeviceIds();
  if (devices.size === 0) return;
  let queues = '';
  try {
    queues = run('lpstat', ['-v']);
  } catch {
    // lpstat exits non-zero when no queue exists yet.
  }
  for (const [uri, deviceId] of devices) {
    const model = usbModel(uri);
    if (queues.includes(uri) || !isKnownThermal({ name: model, commandSet: parseDeviceId(deviceId).commandSet })) continue;
    try {
      run('lpadmin', ['-p', model.replace(/[^A-Za-z0-9]+/g, '_'), '-E', '-v', uri, '-P', GENERIC_PPD, '-o', 'printer-is-shared=false']);
    } catch {
      // Not an admin user — leave it to System Settings → Printers & Scanners.
    }
  }
}

function readOr(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return undefined;
  }
}

function linuxUsbLp(): DetectedPrinter[] {
  let nodes: string[];
  try {
    nodes = readdirSync('/dev/usb').filter((n) => /^lp\d+$/.test(n));
  } catch {
    return [];
  }
  return nodes.map((node) => {
    const sys = ['usbmisc', 'usb']
      .map((cls) => `/sys/class/${cls}/${node}/device`)
      .find((p) => readOr(`${p}/../idVendor`) !== undefined);
    const vid = sys ? readOr(`${sys}/../idVendor`) : undefined;
    const id = parseDeviceId((sys && readOr(`${sys}/ieee1284_id`)) ?? '');
    const vendorId = vid ? parseInt(vid, 16) : undefined;
    const label = [id.manufacturer, id.model].filter(Boolean).join(' ') || `USB printer ${vid ?? '?'}`;
    const driver = guessDriver({ vendorId, commandSet: id.commandSet, name: label });
    return {
      name: `usb-${node}`,
      description: `${label} (/dev/usb/${node}, ${driver})`,
      config: { driver: { type: driver }, transport: { type: 'device', path: `/dev/usb/${node}` } },
    };
  });
}

/** Parse `lpstat -v` ("device for QUEUE: usb://EPSON/TM-L100?serial=1") into USB queues. */
export function parseLpstatDevices(output: string): { queue: string; uri: string; model: string }[] {
  const queues: { queue: string; uri: string; model: string }[] = [];
  for (const line of output.split('\n')) {
    const m = /^device for (.+?):\s*(usb:\/\/\S+)/.exec(line.trim());
    if (m) queues.push({ queue: m[1], uri: m[2], model: usbModel(m[2]) });
  }
  return queues;
}

function cupsUsbQueues(): DetectedPrinter[] {
  let output: string;
  try {
    output = execFileSync('lpstat', ['-v'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, LANG: 'C' },
    });
  } catch {
    return []; // CUPS not installed or not running
  }
  const { listed, devices } = usbDeviceIds();
  return parseLpstatDevices(output)
    // A queue outlives its printer: when we can see what's plugged in, list only connected ones.
    .filter((q) => !listed || devices.has(q.uri))
    .map((q) => ({ ...q, commandSet: parseDeviceId(devices.get(q.uri) ?? '').commandSet }))
    .filter(({ queue, model, commandSet }) => isKnownThermal({ name: `${queue} ${model}`, commandSet }))
    .map(({ queue, model, commandSet }) => {
      const driver = guessDriver({ name: `${queue} ${model}`, commandSet });
      return {
        name: `cups-${queue}`,
        description: `${model} (CUPS queue ${queue}, ${driver})`,
        config: { driver: { type: driver }, transport: { type: 'spooler', queue } },
      };
    });
}
