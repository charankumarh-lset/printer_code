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
 * - Linux/macOS: USB queues already in CUPS that look like thermal printers
 *   (office printers are skipped so they never receive raw thermal bytes)
 * Windows has no driverless raw path; configure a `spooler` printer there.
 */
export function detectPrinters(): DetectedPrinter[] {
  const found: DetectedPrinter[] = [];
  if (process.platform === 'linux') found.push(...linuxUsbLp());
  if (process.platform !== 'win32') found.push(...cupsUsbQueues());
  return found;
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
