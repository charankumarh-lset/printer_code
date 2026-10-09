// Browser entry (bundled to release/printer-code.browser.js, global `PrinterCode`).
// Prints from a kiosk web page:
//   1. via the local agent (http://127.0.0.1:9123) when it is running, else
//   2. straight to a USB printer with WebUSB (Chrome/Edge/Chromium only).
// Both paths use the same drivers as the Node package.

import { EscPosDriver } from './drivers/escpos';
import { TsplDriver } from './drivers/tspl';
import { ZplDriver } from './drivers/zpl';
import { rgbaToMono } from './mono';
import type { MonoRaster, PrinterDriver } from './types';
import { AutoDriver, guessDriver } from './vendors';

export type Label = Blob | HTMLCanvasElement;

export interface KioskPrintOptions {
  /** Default http://127.0.0.1:9123 */
  agentUrl?: string;
  /** Agent printer name (default: the agent's first printer). */
  printer?: string;
  copies?: number;
  /** WebUSB only: force a driver instead of guessing from the USB vendor. */
  driver?: AutoDriver | PrinterDriver;
}

export interface AgentStatus {
  ok: boolean;
  printers: { name: string; driver: string; transport: string; description?: string }[];
}

const DEFAULT_AGENT = 'http://127.0.0.1:9123';
const PRINTER_CLASS = 7;

const DRIVERS: Record<AutoDriver, () => PrinterDriver> = {
  escpos: () => new EscPosDriver(),
  zpl: () => new ZplDriver(),
  tspl: () => new TsplDriver(),
};

/** Agent status, or null when no agent is running on this device. */
export async function agentStatus(agentUrl = DEFAULT_AGENT): Promise<AgentStatus | null> {
  try {
    const res = await fetch(`${agentUrl}/status`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? ((await res.json()) as AgentStatus) : null;
  } catch {
    return null;
  }
}

/**
 * Print labels (PNG blobs or canvases). Uses the agent if present, otherwise
 * WebUSB. Call it from a click handler: the first WebUSB use shows Chrome's
 * printer picker, which needs a user gesture. Resolves with the path used.
 */
export async function printLabels(labels: Label[], opts: KioskPrintOptions = {}): Promise<'agent' | 'webusb'> {
  const agentUrl = opts.agentUrl ?? DEFAULT_AGENT;
  if (await agentStatus(agentUrl)) {
    await printViaAgent(labels, agentUrl, opts);
    return 'agent';
  }
  if (!navigator.usb) {
    throw new Error(`No print agent at ${agentUrl}, and this browser has no WebUSB (use Chrome or Edge).`);
  }
  await printViaWebUsb(labels, opts);
  return 'webusb';
}

async function toPng(label: Label): Promise<Blob> {
  if (label instanceof Blob) return label;
  return new Promise((resolve, reject) =>
    label.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas could not be encoded'))), 'image/png'),
  );
}

async function printViaAgent(labels: Label[], agentUrl: string, opts: KioskPrintOptions): Promise<void> {
  const query = new URLSearchParams({ copies: String(opts.copies ?? 1) });
  if (opts.printer) query.set('printer', opts.printer);
  // Sequential: one job per label, in order.
  for (const label of labels) {
    const res = await fetch(`${agentUrl}/print?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: await toPng(label),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) throw new Error(`Print agent: ${body.error ?? `HTTP ${res.status}`}`);
  }
}

async function toMono(label: Label): Promise<MonoRaster> {
  let source: CanvasImageSource = label as HTMLCanvasElement;
  let width = (label as HTMLCanvasElement).width;
  let height = (label as HTMLCanvasElement).height;
  if (label instanceof Blob) {
    const bmp = await createImageBitmap(label);
    [source, width, height] = [bmp, bmp.width, bmp.height];
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  return rgbaToMono(ctx.getImageData(0, 0, width, height).data, width, height);
}

function printerAlternate(device: USBDevice) {
  for (const iface of device.configuration?.interfaces ?? []) {
    const alt = iface.alternates.find((a) => a.interfaceClass === PRINTER_CLASS);
    const out = alt?.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
    if (alt && out) return { iface, alt, out };
  }
  return null;
}

/** Show Chrome's USB picker (printers only). Must run inside a click handler. */
export function pairUsbPrinter(): Promise<USBDevice> {
  return navigator.usb.requestDevice({ filters: [{ classCode: PRINTER_CLASS }] });
}

/** A USB printer this site was already granted (or via kiosk policy), else ask the user once. */
async function usbPrinter(): Promise<USBDevice> {
  const granted = await navigator.usb.getDevices();
  const printer = granted.find((d) =>
    d.configurations.some((c) => c.interfaces.some((i) => i.alternates.some((a) => a.interfaceClass === PRINTER_CLASS))),
  );
  return printer ?? pairUsbPrinter();
}

async function printViaWebUsb(labels: Label[], opts: KioskPrintOptions): Promise<void> {
  const device = await usbPrinter();
  const driver =
    typeof opts.driver === 'object' ? opts.driver : DRIVERS[opts.driver ?? guessDriver({ vendorId: device.vendorId, name: device.productName ?? undefined })]();
  // Encode everything first so a bad image fails before anything prints.
  const payloads: Uint8Array<ArrayBuffer>[] = [];
  for (const label of labels) payloads.push(new Uint8Array(driver.encode(await toMono(label))));

  await device.open();
  try {
    if (!device.configuration) await device.selectConfiguration(1);
    const target = printerAlternate(device);
    if (!target) throw new Error(`${device.productName ?? 'USB device'} has no printer interface`);
    await device.claimInterface(target.iface.interfaceNumber);
    if (target.alt.alternateSetting !== 0) {
      await device.selectAlternateInterface(target.iface.interfaceNumber, target.alt.alternateSetting);
    }
    for (const payload of payloads) {
      for (let c = 0; c < (opts.copies ?? 1); c++) {
        const result = await device.transferOut(target.out.endpointNumber, payload);
        if (result.status !== 'ok') throw new Error(`USB transfer ${result.status}`);
      }
    }
    await device.releaseInterface(target.iface.interfaceNumber);
  } catch (err) {
    if ((err as Error).message?.includes('claim')) {
      throw new Error('Printer is held by the OS driver. On Linux run install/webusb-linux.sh once (see README).');
    }
    throw err;
  } finally {
    await device.close().catch(() => undefined);
  }
}
