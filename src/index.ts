import { EposDriver } from './drivers/epos';
import { EscPosDriver, EscPosOptions } from './drivers/escpos';
import { TsplDriver, TsplOptions } from './drivers/tspl';
import { ZplDriver } from './drivers/zpl';
import { defaultDpi, labelScale } from './dpi';
import { pngToMono } from './raster';
import { DeviceOptions, DeviceTransport } from './transports/device';
import { EposHttpOptions, EposHttpTransport } from './transports/epos-http';
import { SpoolerOptions, SpoolerTransport } from './transports/spooler';
import { TcpOptions, TcpTransport } from './transports/tcp';
import { WinspoolOptions, WinspoolTransport } from './transports/winspool';
import type { MonoRaster, PrinterConfig, PrinterDriver, Transport } from './types';

export * from './types';
export { assertRaster, pngToMono, rgbaToMono, scaleRgba, testPattern } from './raster';
export { defaultDpi, labelScale } from './dpi';
export { EscPosDriver, ZplDriver, TsplDriver, EposDriver };
export { TcpTransport, DeviceTransport, SpoolerTransport, EposHttpTransport, WinspoolTransport };
export { detectPrinters, DetectedPrinter } from './detect';
export { discoverNetworkPrinters, NetworkPrinter, scanTargets } from './discover';
export { SavedPrinters } from './saved';
export { guessDriver, isKnownThermal, parseDeviceId } from './vendors';

type Options = Record<string, unknown>;
export type DriverFactory = (options: Options) => PrinterDriver;
export type TransportFactory = (options: Options) => Transport;

const drivers = new Map<string, DriverFactory>([
  ['escpos', (o) => new EscPosDriver(o as EscPosOptions)],
  ['zpl', () => new ZplDriver()],
  ['tspl', (o) => new TsplDriver(o as TsplOptions)],
  ['epos', () => new EposDriver()],
]);

const transports = new Map<string, TransportFactory>([
  ['tcp', (o) => new TcpTransport(o as unknown as TcpOptions)],
  ['device', (o) => new DeviceTransport(o as unknown as DeviceOptions)],
  ['spooler', (o) => new SpoolerTransport(o as unknown as SpoolerOptions)],
  ['epos-http', (o) => new EposHttpTransport(o as unknown as EposHttpOptions)],
  ['winspool', (o) => new WinspoolTransport(o as unknown as WinspoolOptions)],
]);

/** Add (or override) a printer language — see examples/escpos-legacy.plugin.js. */
export function registerDriver(type: string, factory: DriverFactory): void {
  drivers.set(type, factory);
}

/** Add (or override) a delivery path, e.g. libusb, serialport, Bluetooth LE. */
export function registerTransport(type: string, factory: TransportFactory): void {
  transports.set(type, factory);
}

export function listDrivers(): string[] {
  return [...drivers.keys()];
}

export function listTransports(): string[] {
  return [...transports.keys()];
}

/** A label to print: PNG file contents, or an already-thresholded raster. */
export type LabelInput = Buffer | MonoRaster;

export class Printer {
  constructor(
    readonly driver: PrinterDriver,
    readonly transport: Transport,
    private readonly widthDots?: number,
    /** Enlargement applied to PNG labels for the print head (see dpi.ts). */
    private readonly scale = 1,
  ) {}

  /**
   * Print labels in order, ONE job per label, each sent only after the
   * previous one was accepted. Batching many raster labels into one job
   * overflows small printer buffers (Epson TM ≈128KB ≈ 3 labels) and the
   * printer silently truncates mid-label.
   *
   * Every label is decoded and encoded before anything is sent, so a bad
   * image fails the whole call instead of half-printing a batch.
   */
  async print(labels: LabelInput | LabelInput[], copies = 1): Promise<void> {
    const list = Array.isArray(labels) ? labels : [labels];
    const payloads = list.map((label, i) => {
      // Enlarging turns thin strokes grey; a darker cutoff keeps small text solid.
      const raster = Buffer.isBuffer(label) ? pngToMono(label, this.scale === 1 ? 128 : 190, this.scale) : label;
      if (this.widthDots && raster.width > this.widthDots) {
        throw new Error(`label ${i + 1} is ${raster.width} dots wide; printer max is ${this.widthDots}`);
      }
      return this.driver.encode(raster);
    });
    for (const payload of payloads) {
      for (let c = 0; c < copies; c++) await this.transport.send(payload);
    }
  }
}

/** `name` (and the config's description/queue) pick the brand's default dpi when the config sets none. */
export function createPrinter(config: PrinterConfig & { description?: string }, name = ''): Printer {
  const { type: driverType, ...driverOpts } = config.driver;
  const dpi = config.dpi ?? (typeof driverOpts.dpi === 'number' ? driverOpts.dpi
    : defaultDpi(`${name} ${config.description ?? ''} ${String(config.transport.queue ?? config.transport.printer ?? '')}`));
  // TSPL sizes the label in mm from dots ÷ dpi, so it must use the same resolution.
  if (driverType === 'tspl') {
    driverOpts.dpi = dpi;
    if (config.shiftMm) driverOpts.shiftMm = config.shiftMm;
  }
  const { type: transportType, ...transportOpts } = config.transport;

  const driver = drivers.get(driverType);
  if (!driver) throw new Error(`Unknown driver "${driverType}". Known: ${listDrivers().join(', ')}`);
  const transport = transports.get(transportType);
  if (!transport) throw new Error(`Unknown transport "${transportType}". Known: ${listTransports().join(', ')}`);
  // ePOS XML only makes sense over epos-http (or to a file for a dry run).
  if ((driverType === 'epos') !== (transportType === 'epos-http') && transportType !== 'device') {
    throw new Error('The "epos" driver and the "epos-http" transport must be used together');
  }

  return new Printer(driver(driverOpts), transport(transportOpts), config.widthDots, labelScale(dpi));
}
