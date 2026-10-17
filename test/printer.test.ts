import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { PNG } from 'pngjs';

import { createPrinter, defaultDpi, pngToMono, registerDriver, registerTransport } from '../src';
import { parseInstalledPrinters, parseWindowsPrinters } from '../src/detect';
import { rawPrintScript } from '../src/transports/winspool';

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

test('dpi: Seznik defaults to 300, Epson and unknown printers to 203', () => {
  assert.equal(defaultDpi('Seznik B15'), 300);
  assert.equal(defaultDpi('cups-SEZNIK_B15'), 300);
  assert.equal(defaultDpi('EPSON TM-L100'), 203);
  assert.equal(defaultDpi('Xprinter XP-365B'), 203);
});

test('print: a 300 dpi Seznik keeps a 50 mm label 50 mm (scaled up, TSPL SIZE in mm)', async () => {
  const sent: string[] = [];
  registerTransport('memory-tspl', () => ({ send: async (b) => void sent.push(b.toString('latin1')) }));
  const label = png(400, 400, (x, y) => (x + y) % 7 === 0); // 50 × 50 mm at 8 dots/mm
  await createPrinter({ driver: { type: 'tspl' }, transport: { type: 'memory-tspl' } }, 'Seznik B15').print(label);
  assert.match(sent[0], /^SIZE 50\.\d mm,50\.\d mm\r\n/);
  assert.match(sent[0], /BITMAP 0,0,74,591,/); // 591 dots ≈ 50 mm at 300 dpi, padded to 592 = 74 bytes
});

test('print: explicit dpi wins over the brand default; 203 dpi printers are not resampled', async () => {
  const sent: string[] = [];
  registerTransport('memory-tspl-2', () => ({ send: async (b) => void sent.push(b.toString('latin1')) }));
  const label = png(400, 240, () => false);
  await createPrinter({ driver: { type: 'tspl' }, transport: { type: 'memory-tspl-2' }, dpi: 203 }, 'Seznik B15').print(label);
  await createPrinter({ driver: { type: 'tspl' }, transport: { type: 'memory-tspl-2' } }, 'EPSON TM').print(label);
  for (const job of sent) assert.match(job, /BITMAP 0,0,50,240,/);
});

test('windows detection: finds the Seznik by name (TSPL, 300 dpi), skips office and virtual printers', () => {
  const getPrinter = JSON.stringify([
    { Name: 'Seznik B15', DriverName: 'Seznik_B15 Printer', PortName: 'USB002' },
    { Name: 'Canon G3010 series', DriverName: 'Canon G3010 series', PortName: 'USB001' },
    { Name: 'OneNote (Desktop)', DriverName: 'Send to Microsoft OneNote 16 Driver', PortName: 'nul:' },
    { Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:' },
  ]);
  const found = parseWindowsPrinters(getPrinter);
  assert.deepEqual(found.map((p) => p.name), ['Seznik B15']);
  assert.deepEqual(found[0].config, { driver: { type: 'tspl' }, transport: { type: 'winspool', printer: 'Seznik B15' } });
  assert.equal(defaultDpi(`${found[0].name} ${found[0].description}`), 300);
  // ConvertTo-Json emits a bare object for a single printer, and nothing at all for none.
  assert.equal(parseWindowsPrinters(JSON.stringify({ Name: 'Seznik B15', PortName: 'USB002' })).length, 1);
  assert.deepEqual(parseWindowsPrinters(''), []);
});

test('windows detection: a Seznik without its driver ("B15-71C7") is still found as TSPL, 300 dpi', () => {
  const found = parseWindowsPrinters(JSON.stringify({ Name: 'B15-71C7', DriverName: 'Generic / Text Only', PortName: 'USB001' }));
  assert.deepEqual(found.map((p) => p.name), ['B15-71C7']);
  assert.deepEqual(found[0].config, { driver: { type: 'tspl' }, transport: { type: 'winspool', printer: 'B15-71C7' } });
  assert.equal(defaultDpi(`${found[0].name} ${found[0].description}`), 300);
  assert.equal(defaultDpi('Seznik_B15 Printer'), 300);
});

test('windows: every installed printer is listed, thermal first, with guessed language and dpi', () => {
  const all = parseInstalledPrinters(JSON.stringify([
    { Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:' },
    { Name: 'Kitchen 1', DriverName: 'Seznik B15', PortName: 'USB001' },
    { Name: 'Printer 2', DriverName: 'Generic / Text Only', PortName: 'USB002' },
  ]));
  assert.deepEqual(all.map((p) => [p.name, p.thermal, p.driver, p.dpi]), [
    ['Kitchen 1', true, 'tspl', 300],
    ['Microsoft Print to PDF', false, 'escpos', 203],
    ['Printer 2', false, 'escpos', 203],
  ]);
  assert.deepEqual(parseInstalledPrinters('not json'), []);
});

test('winspool: RAW spooler script takes printer and file from the environment only', () => {
  const script = rawPrintScript();
  assert.match(script, /pDataType = "RAW"/);
  assert.match(script, /\[AntzRawPrint\]::Send\(\$env:ANTZ_PRINTER, \[IO\.File\]::ReadAllBytes\(\$env:ANTZ_FILE\)\)/);
  assert.throws(() => createPrinter({ driver: { type: 'tspl' }, transport: { type: 'winspool' } }), /needs "printer"/);
});
