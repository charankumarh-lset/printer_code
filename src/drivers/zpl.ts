import { assertRaster } from '../mono';
import type { MonoRaster, PrinterDriver } from '../types';

/** ZPL II — Zebra and ZPL-compatible label printers. Image sent as one ^GFA graphic field. */
export class ZplDriver implements PrinterDriver {
  encode(r: MonoRaster): Buffer {
    assertRaster(r);
    const total = r.data.length;
    const hex = r.data.toString('hex').toUpperCase(); // ZPL: set bit = black, same as MonoRaster
    return Buffer.from(
      `^XA^PW${r.width}^LL${r.height}^FO0,0^GFA,${total},${total},${r.width / 8},${hex}^FS^XZ`,
      'ascii',
    );
  }
}
