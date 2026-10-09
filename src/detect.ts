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
const MAC_SCAN_INTERVAL_MS = 5000;
let lastMacScan = 0;

/** USB device URIs from `lpinfo -v` ("direct usb://EPSON/TM-L100?serial=1"). */
export function parseLpinfoUsb(output: string): string[] {
  return output
    .split('\n')
    .map((line) => /^direct\s+(usb:\/\/\S+)/.exec(line.trim())?.[1])
    .filter((uri): uri is string => !!uri);
}

/**
 * macOS dropped raw CUPS queues, so a USB thermal printer isn't printable
 * until it has a queue. Add one with the generic driver — the spooler
 * transport prints with `lp -o raw`, which bypasses it per job. Probes only
 * the usb backend (~0.1 s) and at most every 5 s. Needs an admin user
 * (member of _lpadmin); otherwise the printer must be added in System Settings.
 */
function addMacUsbPrinters(): void {
  if (Date.now() - lastMacScan < MAC_SCAN_INTERVAL_MS) return;
  lastMacScan = Date.now();
  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, LANG: 'C' },
    });
  let devices: string[];
  try {
    devices = parseLpinfoUsb(run('lpinfo', ['--include-schemes', 'usb', '-v']));
  } catch {
    return; // CUPS not available
  }
  let queues = '';
  try {
    queues = run('lpstat', ['-v']);
  } catch {
    // lpstat exits non-zero when no queue exists yet.
  }
  for (const uri of devices) {
    const model = decodeURIComponent(uri.replace(/^usb:\/\/|\?.*$/g, ''));
    if (queues.includes(uri) || !isKnownThermal({ name: model })) continue;
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
export function parseLpstatDevices(output: string): { queue: string; model: string }[] {
  const queues: { queue: string; model: string }[] = [];
  for (const line of output.split('\n')) {
    const m = /^device for (.+?):\s*usb:\/\/([^?\s]+)/.exec(line.trim());
    if (m) queues.push({ queue: m[1], model: decodeURIComponent(m[2]).replace('/', ' ') });
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
  return parseLpstatDevices(output)
    .filter(({ queue, model }) => isKnownThermal({ name: `${queue} ${model}` }))
    .map(({ queue, model }) => {
      const driver = guessDriver({ name: `${queue} ${model}` });
      return {
        name: `cups-${queue}`,
        description: `${model} (CUPS queue ${queue}, ${driver})`,
        config: { driver: { type: driver }, transport: { type: 'spooler', queue } },
      };
    });
}
