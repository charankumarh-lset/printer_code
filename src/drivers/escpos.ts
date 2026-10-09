import { assertRaster } from '../mono';
import type { MonoRaster, PrinterDriver } from '../types';

export interface EscPosOptions {
  cut?: 'full' | 'partial' | 'none';
  /** Lines to feed after the image, before cutting (default 3). */
  feedLines?: number;
}

/** Most printer firmwares cap one GS v 0 command at ~2303 rows; send taller images in bands. */
const BAND_ROWS = 1024;

/**
 * ESC/POS raster ("GS v 0") — Epson TM series and most generic 58/80 mm
 * thermal receipt/label printers (Xprinter, Rongta, HPRT, Bixolon, ...).
 * Same byte layout as the kitchen backend's rasterToEscPos.
 */
export class EscPosDriver implements PrinterDriver {
  constructor(private readonly opts: EscPosOptions = {}) {}

  encode(r: MonoRaster): Buffer {
    assertRaster(r);
    const bytesPerRow = r.width / 8;
    const parts: Buffer[] = [Buffer.from([0x1b, 0x40])]; // ESC @ — reset printer state
    for (let y = 0; y < r.height; y += BAND_ROWS) {
      const h = Math.min(BAND_ROWS, r.height - y);
      parts.push(
        Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]),
        r.data.subarray(y * bytesPerRow, (y + h) * bytesPerRow),
      );
    }
    parts.push(Buffer.from([0x1b, 0x64, this.opts.feedLines ?? 3])); // ESC d n
    const cut = this.opts.cut ?? 'full';
    if (cut !== 'none') parts.push(Buffer.from([0x1d, 0x56, cut === 'full' ? 0x00 : 0x01])); // GS V
    return Buffer.concat(parts);
  }
}
