import { assertRaster } from '../mono';
import type { MonoRaster, PrinterDriver } from '../types';

export interface TsplOptions {
  /** Print head resolution, used to size the label in mm (default 203). */
  dpi?: number;
  /** Gap between labels in mm (default 2; use 0 for continuous media). */
  gapMm?: number;
}

/** TSPL — TSC and TSPL-compatible label printers (many budget 2"/4" label printers). */
export class TsplDriver implements PrinterDriver {
  constructor(private readonly opts: TsplOptions = {}) {}

  encode(r: MonoRaster): Buffer {
    assertRaster(r);
    const dpi = this.opts.dpi ?? 203;
    const mm = (dots: number) => ((dots / dpi) * 25.4).toFixed(1);
    const head =
      `SIZE ${mm(r.width)} mm,${mm(r.height)} mm\r\n` +
      `GAP ${this.opts.gapMm ?? 2} mm,0 mm\r\n` +
      'DIRECTION 1\r\nCLS\r\n' +
      `BITMAP 0,0,${r.width / 8},${r.height},0,`;
    // TSPL bitmaps are inverted relative to MonoRaster: a 0 bit prints black.
    const inverted = Buffer.from(r.data.map((b) => b ^ 0xff));
    return Buffer.concat([Buffer.from(head, 'ascii'), inverted, Buffer.from('\r\nPRINT 1,1\r\n', 'ascii')]);
  }
}
