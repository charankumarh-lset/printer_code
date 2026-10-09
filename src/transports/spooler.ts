import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

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
 * - Windows: write to the shared printer \\<host>\<queue> (the RAW-spool
 *   equivalent of `copy /b file \\localhost\<queue>`)
 */
export class SpoolerTransport implements Transport {
  constructor(private readonly opts: SpoolerOptions) {
    if (!opts.queue) throw new Error('spooler transport needs "queue"');
  }

  send(payload: Buffer): Promise<void> {
    if (process.platform === 'win32') {
      return writeFile(`\\\\${this.opts.host ?? 'localhost'}\\${this.opts.queue}`, payload);
    }
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
}
