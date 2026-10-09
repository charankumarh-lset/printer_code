/**
 * A 1-bit monochrome image: row-major, 8 pixels per byte, MSB first,
 * a set bit = black dot. `width` is always a multiple of 8.
 */
export interface MonoRaster {
  width: number;
  height: number;
  data: Buffer;
}

/** A printer language: turns one label image into the bytes the printer expects. */
export interface PrinterDriver {
  encode(raster: MonoRaster): Buffer;
}

/** A delivery path: gets encoded bytes to the printer (socket, device file, OS queue, HTTP). */
export interface Transport {
  send(payload: Buffer): Promise<void>;
}

export interface PrinterConfig {
  /** `type` picks a registered driver; the remaining keys are its options. */
  driver: { type: string; [option: string]: unknown };
  /** `type` picks a registered transport; the remaining keys are its options. */
  transport: { type: string; [option: string]: unknown };
  /** Printable width in dots; wider images are rejected instead of silently clipped. */
  widthDots?: number;
}

/** How the printer is attached, as shown in the app's printer settings. */
export type Connection = 'usb' | 'ethernet' | 'wifi' | 'network';

/** A printer as the agent and CLI list it: config plus display details. */
export type NamedPrinter = PrinterConfig & {
  description?: string;
  connection?: Connection;
  /** Network printers: hardware address, used to find the printer again when its IP changes. */
  mac?: string;
};
