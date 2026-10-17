import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Transport } from '../types';
import { rawPrint, winspool } from '../win32';

export interface WinspoolOptions {
  /** Windows printer name exactly as in Settings → Printers (e.g. "Seznik B15"). No sharing needed. */
  printer: string;
}

// Win32 spooler RAW job: OpenPrinter → StartDocPrinter("RAW") → WritePrinter.
const RAW_PRINT_CS = `
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AntzRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  static Exception Fail(string what) { return new Win32Exception(Marshal.GetLastWin32Error(), what); }
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw Fail("Cannot open printer '" + printer + "'");
    try {
      if (StartDocPrinter(h, 1, new DocInfo { pDocName = "Antz label", pDataType = "RAW" }) == 0) throw Fail("Cannot start print job");
      try {
        if (!StartPagePrinter(h)) throw Fail("Cannot start page");
        int written;
        if (!WritePrinter(h, data, data.Length, out written) || written != data.Length) throw Fail("Printer accepted " + written + " of " + data.Length + " bytes");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}`;

/**
 * PowerShell script that sends $env:ANTZ_FILE to $env:ANTZ_PRINTER. The C#
 * helper is compiled once into %TEMP% (named by its hash) and reused, so a
 * job doesn't pay the compiler's start-up time.
 */
export function rawPrintScript(): string {
  const hash = createHash('sha256').update(RAW_PRINT_CS).digest('hex').slice(0, 12);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$dll = Join-Path $env:TEMP 'antz-rawprint-${hash}.dll'`,
    `if (-not (Test-Path $dll)) { Add-Type -TypeDefinition @'\n${RAW_PRINT_CS}\n'@ -OutputAssembly $dll }`,
    '[void][Reflection.Assembly]::LoadFile($dll)',
    '[AntzRawPrint]::Send($env:ANTZ_PRINTER, [IO.File]::ReadAllBytes($env:ANTZ_FILE))',
  ].join('\n');
}

/** Send RAW bytes to an installed Windows printer by name, through the Win32 spooler. */
export class WinspoolTransport implements Transport {
  constructor(private readonly opts: WinspoolOptions) {
    if (!opts.printer) throw new Error('winspool transport needs "printer"');
  }

  async send(payload: Buffer): Promise<void> {
    if (process.platform !== 'win32') throw new Error('winspool transport only works on Windows');
    const w = winspool();
    if (w) {
      try {
        return rawPrint(w, this.opts.printer, payload);
      } catch (err) {
        throw new Error(`printing to "${this.opts.printer}" failed: ${(err as Error).message}`);
      }
    }
    // Native module unavailable: compile and run the same spooler calls through PowerShell.
    const dir = await mkdtemp(join(tmpdir(), 'printer-agent-'));
    const file = join(dir, 'label.bin');
    try {
      await writeFile(file, payload);
      // Printer name and file travel in env vars, so no quoting can break the command.
      const encoded = Buffer.from(rawPrintScript(), 'utf16le').toString('base64');
      await new Promise<void>((resolve, reject) => {
        try {
          execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
            { env: { ...process.env, ANTZ_PRINTER: this.opts.printer, ANTZ_FILE: file }, timeout: 60000, windowsHide: true },
            (err, _stdout, stderr) => err ? reject(new Error(`printing to "${this.opts.printer}" failed: ${(stderr || err.message).trim().split('\n')[0]}`)) : resolve());
        } catch (err) {
          // A program blocked by Group Policy fails synchronously ("spawn UNKNOWN").
          reject(new Error(`printing to "${this.opts.printer}" failed: PowerShell could not start (${(err as Error).message}, blocked by policy?)`));
        }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
