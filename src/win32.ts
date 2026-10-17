/**
 * Windows print spooler (winspool.drv) called directly through koffi (FFI),
 * so listing and printing start no other program. Domain laptops often block
 * powershell.exe by Group Policy; this path doesn't need it.
 */
import type { WindowsPrinter } from './detect';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = ((...args: any[]) => any) & { async: (...args: any[]) => void };

interface Winspool {
  koffi: any;
  PRINTER_INFO_2: unknown;
  EnumPrintersW: Fn;
  OpenPrinterW: Fn;
  ClosePrinter: Fn;
  StartDocPrinterW: Fn;
  StartPagePrinter: Fn;
  WritePrinter: Fn;
  EndPagePrinter: Fn;
  EndDocPrinter: Fn;
  GetLastError: Fn;
}

let api: Winspool | null | undefined;
/** Why koffi could not be loaded, when it couldn't. */
export let winspoolLoadError: string | undefined;

/** The spooler functions, or null when koffi can't load (not Windows, or the native module is missing/blocked). */
export function winspool(): Winspool | null {
  if (api !== undefined) return api;
  if (process.platform !== 'win32') return (api = null);
  try {
    // Shipped next to printer-agent.js in runtime/node_modules/koffi (kept out of the bundle: it has a native module).
    const koffi = require('koffi');
    const lib = koffi.load('winspool.drv');
    const kernel32 = koffi.load('kernel32.dll');
    const PRINTER_INFO_2 = koffi.struct('PRINTER_INFO_2W', {
      pServerName: 'str16', pPrinterName: 'str16', pShareName: 'str16', pPortName: 'str16',
      pDriverName: 'str16', pComment: 'str16', pLocation: 'str16', pDevMode: 'void *',
      pSepFile: 'str16', pPrintProcessor: 'str16', pDatatype: 'str16', pParameters: 'str16',
      pSecurityDescriptor: 'void *', Attributes: 'uint32', Priority: 'uint32', DefaultPriority: 'uint32',
      StartTime: 'uint32', UntilTime: 'uint32', Status: 'uint32', cJobs: 'uint32', AveragePPM: 'uint32',
    });
    koffi.struct('DOC_INFO_1W', { pDocName: 'str16', pOutputFile: 'str16', pDatatype: 'str16' });
    api = {
      koffi,
      PRINTER_INFO_2,
      EnumPrintersW: lib.func('bool __stdcall EnumPrintersW(uint32 Flags, str16 Name, uint32 Level, void *pPrinterEnum, uint32 cbBuf, _Out_ uint32 *pcbNeeded, _Out_ uint32 *pcReturned)'),
      OpenPrinterW: lib.func('bool __stdcall OpenPrinterW(str16 pPrinterName, _Out_ void **phPrinter, void *pDefault)'),
      ClosePrinter: lib.func('bool __stdcall ClosePrinter(void *hPrinter)'),
      StartDocPrinterW: lib.func('uint32 __stdcall StartDocPrinterW(void *hPrinter, uint32 Level, DOC_INFO_1W *pDocInfo)'),
      StartPagePrinter: lib.func('bool __stdcall StartPagePrinter(void *hPrinter)'),
      WritePrinter: lib.func('bool __stdcall WritePrinter(void *hPrinter, void *pBuf, uint32 cbBuf, _Out_ uint32 *pcWritten)'),
      EndPagePrinter: lib.func('bool __stdcall EndPagePrinter(void *hPrinter)'),
      EndDocPrinter: lib.func('bool __stdcall EndDocPrinter(void *hPrinter)'),
      GetLastError: kernel32.func('uint32 __stdcall GetLastError()'),
    };
  } catch (err) {
    winspoolLoadError = (err as Error).message;
    api = null;
  }
  return api;
}

const PRINTER_ENUM_LOCAL = 0x2;
const PRINTER_ENUM_CONNECTIONS = 0x4;

function callAsync(fn: Fn, ...args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => fn.async(...args, (err: Error | null, res: unknown) => (err ? reject(err) : resolve(res))));
}

/**
 * Installed printers (local and connected network ones), like Get-Printer.
 * Runs off the main thread: with many mapped network printers it can take seconds.
 */
export async function enumPrinters(w: Winspool): Promise<WindowsPrinter[]> {
  const flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
  for (let attempt = 0; attempt < 3; attempt++) {
    const needed = [0], count = [0];
    await callAsync(w.EnumPrintersW, flags, null, 2, null, 0, needed, count);
    if (needed[0] === 0) return [];
    const buf = Buffer.alloc(needed[0]);
    // Fails (insufficient buffer) only if a printer was added between the two calls; then size again.
    if (!(await callAsync(w.EnumPrintersW, flags, null, 2, buf, buf.length, needed, count))) continue;
    if (count[0] === 0) return [];
    const list: { pPrinterName: string; pDriverName: string | null; pPortName: string | null }[] =
      w.koffi.decode(buf, 0, w.PRINTER_INFO_2, count[0]);
    return list.map((p) => ({ Name: p.pPrinterName, DriverName: p.pDriverName ?? undefined, PortName: p.pPortName ?? undefined }));
  }
  throw new Error('EnumPrinters failed');
}

/** Send RAW bytes to an installed printer by name: OpenPrinter → StartDocPrinter("RAW") → WritePrinter. */
export function rawPrint(w: Winspool, printer: string, data: Buffer): void {
  const fail = (what: string) => new Error(`${what} (Windows error ${w.GetLastError()})`);
  const handle = [null];
  if (!w.OpenPrinterW(printer, handle, null)) throw fail(`Cannot open printer "${printer}"`);
  const h = handle[0];
  try {
    if (w.StartDocPrinterW(h, 1, { pDocName: 'Antz label', pOutputFile: null, pDatatype: 'RAW' }) === 0) throw fail('Cannot start print job');
    try {
      if (!w.StartPagePrinter(h)) throw fail('Cannot start page');
      const written = [0];
      if (!w.WritePrinter(h, data, data.length, written) || written[0] !== data.length) {
        throw fail(`Printer accepted ${written[0]} of ${data.length} bytes`);
      }
      w.EndPagePrinter(h);
    } finally {
      w.EndDocPrinter(h);
    }
  } finally {
    w.ClosePrinter(h);
  }
}
