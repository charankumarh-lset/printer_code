import { assertRaster } from '../mono';
import type { MonoRaster, PrinterDriver } from '../types';

/**
 * Epson ePOS-Print XML — TM printers with ePOS-Print enabled (e.g. TM-L100).
 * Pair with the `epos-http` transport, which wraps this document in the SOAP
 * envelope and POSTs it to the printer. Same result as the admin app's
 * epos-2.js path, but without Epson's browser SDK, so it runs headless.
 */
export class EposDriver implements PrinterDriver {
  encode(r: MonoRaster): Buffer {
    assertRaster(r);
    return Buffer.from(
      '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' +
        `<image width="${r.width}" height="${r.height}" color="color_1" mode="mono">${r.data.toString('base64')}</image>` +
        '<cut type="feed"/>' +
        '</epos-print>',
      'utf8',
    );
  }
}
