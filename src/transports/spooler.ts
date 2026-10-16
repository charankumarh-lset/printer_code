import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Transport } from '../types';

export interface SpoolerOptions {
  /** CUPS queue name (Linux/macOS) or printer share name (Windows). */
  queue: string;
  /** Windows only: machine sharing the printer (default localhost). */
  host?: string;
}

/**
 * Hand raw bytes to the OS print queue, so any printer the OS already sees
 * (USB, Bluetooth, network) works without knowing its address:
 * - Linux/macOS: `lp -d <queue> -o raw` (CUPS)
 * - Windows: `copy /b file \\<host>\<queue>` to the shared printer (RAW spool)
 */
export class SpoolerTransport implements Transport {
  constructor(private readonly opts: SpoolerOptions) {
    if (!opts.queue) throw new Error('spooler transport needs "queue"');
  }

  send(payload: Buffer): Promise<void> {
    if (process.platform === 'win32') return this.sendWindows(payload);
    return new Promise((resolve, reject) => {
      const lp = spawn('lp', ['-d', this.opts.queue, '-o', 'raw'], { stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      lp.stderr.on('data', (d) => (stderr += d));
      lp.on('error', reject); // e.g. CUPS not installed
      lp.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`lp exited with ${code}: ${stderr.trim()}`)),
      );
      lp.stdin.end(payload);
    });
  }

  /**
   * Node can't open \\host\share as a file (it resolves it to the share's root
   * folder, "\\host\share\"), so hand the bytes to the spooler the classic way:
   * `copy /b <file> \\host\share`.
   */
  private async sendWindows(payload: Buffer): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'printer-agent-'));
    const file = join(dir, 'label.bin');
    try {
      await writeFile(file, payload);
      await new Promise<void>((resolve, reject) => {
        execFile('cmd.exe', windowsCopyArgs(file, this.opts.host ?? 'localhost', this.opts.queue), { windowsVerbatimArguments: true, timeout: 30000 }, (err, stdout, stderr) =>
          err ? reject(new Error(`copy to \\\\${this.opts.host ?? 'localhost'}\\${this.opts.queue} failed: ${(stderr || stdout || err.message).trim()}`)) : resolve());
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** cmd.exe arguments for `copy /b "<file>" "\\host\queue"` (quoted for paths and share names with spaces). */
export function windowsCopyArgs(file: string, host: string, queue: string): string[] {
  if (/["\r\n]/.test(file + host + queue)) throw new Error('printer share name and path must not contain quotes or line breaks');
  return ['/d', '/s', '/c', `"copy /b "${file}" "\\\\${host}\\${queue}""`];
}
