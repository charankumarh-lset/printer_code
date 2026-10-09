import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { PNG } from 'pngjs';

import { createPrinter, pngToMono, registerDriver, registerTransport } from '../src';

function png(width: number, height: number, black: (x: number, y: number) => boolean): Buffer {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = black(x, y) ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(img);
}

test('pngToMono: thresholds pixels and pads width to a multiple of 8', () => {
  const r = pngToMono(png(10, 2, (x, y) => y === 0 && x < 9));
  assert.equal(r.width, 16);
  assert.deepEqual([...r.data], [0xff, 0x80, 0x00, 0x00]);
});

test('createPrinter: unknown names and epos misuse fail with a clear message', () => {
  assert.throws(() => createPrinter({ driver: { type: 'nope' }, transport: { type: 'tcp', host: 'x' } }), /Unknown driver/);
  assert.throws(() => createPrinter({ driver: { type: 'epos' }, transport: { type: 'tcp', host: 'x' } }), /epos/);
});

test('print: rejects labels wider than the printer before sending anything', async () => {
  const sent: Buffer[] = [];
  registerTransport('memory-wide', () => ({ send: async (b) => void sent.push(b) }));
  const p = createPrinter({ driver: { type: 'escpos' }, transport: { type: 'memory-wide' }, widthDots: 8 });
  await assert.rejects(p.print([png(8, 1, () => true), png(16, 1, () => true)]), /16 dots wide/);
  assert.equal(sent.length, 0);
});

test('print: one job per label per copy, using a custom driver and transport', async () => {
  const sent: string[] = [];
  registerDriver('dims', () => ({ encode: (r) => Buffer.from(`${r.width}x${r.height}`) }));
  registerTransport('memory', () => ({ send: async (b) => void sent.push(b.toString()) }));
  const p = createPrinter({ driver: { type: 'dims' }, transport: { type: 'memory' } });
  await p.print([png(8, 1, () => true), png(16, 2, () => true)], 2);
  assert.deepEqual(sent, ['8x1', '8x1', '16x2', '16x2']);
});

test('tcp transport: delivers the exact bytes to a raw 9100-style socket', async () => {
  const received: Buffer[] = [];
  const server = createServer((s) => s.on('data', (d) => received.push(d)).on('end', () => s.end()));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    const p = createPrinter({ driver: { type: 'zpl' }, transport: { type: 'tcp', host: '127.0.0.1', port } });
    await p.print({ width: 8, height: 1, data: Buffer.from([0xaa]) });
    assert.equal(Buffer.concat(received).toString(), '^XA^PW8^LL1^FO0,0^GFA,1,1,1,AA^FS^XZ');
  } finally {
    server.close();
  }
});

test('device transport: writes encoded bytes to a file (dry run)', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'printer-code-')), 'out.bin');
  const p = createPrinter({ driver: { type: 'escpos' }, transport: { type: 'device', path } });
  await p.print({ width: 8, height: 1, data: Buffer.from([0xff]) });
  assert.equal(readFileSync(path).subarray(0, 4).toString('hex'), '1b401d76');
});

test('example plugin: escpos-legacy encodes 24-dot column strips', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../examples/escpos-legacy.plugin.js')({ registerDriver, registerTransport });
  const sent: Buffer[] = [];
  registerTransport('memory-legacy', () => ({ send: async (b) => void sent.push(b) }));
  const p = createPrinter({ driver: { type: 'escpos-legacy' }, transport: { type: 'memory-legacy' } });
  return p.print({ width: 8, height: 1, data: Buffer.from([0x80]) }).then(() => {
    const out = sent[0];
    const strip = out.indexOf(Buffer.from([0x1b, 0x2a, 33, 8, 0])) + 5;
    assert.equal(out[strip], 0x80); // column 0, top dot black
    assert.equal(out[strip + 3], 0x00); // column 1 empty
  });
});
