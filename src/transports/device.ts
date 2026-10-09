import { writeFile } from 'node:fs/promises';

import type { Transport } from '../types';

export interface DeviceOptions {
  path: string;
}

/**
 * Write bytes straight to a path:
 * - Linux USB printer:    /dev/usb/lp0   (user needs the `lp` group)
 * - Linux serial/BT-SPP:  /dev/ttyUSB0, /dev/rfcomm0 (set baud first with `stty`)
 * - Windows shared queue: \\localhost\ShareName
 * - Any file (e.g. out.bin) for a dry run that captures exactly what would be sent.
 */
export class DeviceTransport implements Transport {
  constructor(private readonly opts: DeviceOptions) {
    if (!opts.path) throw new Error('device transport needs "path"');
  }

  send(payload: Buffer): Promise<void> {
    return writeFile(this.opts.path, payload);
  }
}
