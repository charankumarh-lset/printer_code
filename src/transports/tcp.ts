import { createConnection } from 'node:net';

import type { Transport } from '../types';

export interface TcpOptions {
  host: string;
  /** Raw print port — 9100 on virtually every network printer. */
  port?: number;
  timeoutMs?: number;
}

/** Raw socket to a networked printer. The most portable path: works on every OS, no drivers. */
export class TcpTransport implements Transport {
  constructor(private readonly opts: TcpOptions) {
    if (!opts.host) throw new Error('tcp transport needs "host"');
  }

  send(payload: Buffer): Promise<void> {
    const { host, port = 9100, timeoutMs = 10000 } = this.opts;
    return new Promise((resolve, reject) => {
      let flushed = false;
      const socket = createConnection({ host, port }, () => socket.end(payload));
      socket.on('finish', () => (flushed = true));
      socket.setTimeout(timeoutMs, () => {
        // Some printers never close their side; once our bytes are out, that's success.
        if (flushed) {
          socket.destroy();
          resolve();
        } else {
          socket.destroy(new Error(`Printer at ${host}:${port} did not respond (timed out)`));
        }
      });
      socket.on('error', reject);
      socket.on('close', (hadError) => {
        if (!hadError) resolve();
      });
    });
  }
}
