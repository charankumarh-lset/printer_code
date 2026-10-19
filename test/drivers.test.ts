import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EposDriver, EscPosDriver, MonoRaster, TsplDriver, ZplDriver } from '../src';
import { windowsCopyArgs } from '../src/transports/spooler';

// 16 dots wide x 1 row, all black.
const black16x1: MonoRaster = { width: 16, height: 1, data: Buffer.from([0xff, 0xff]) };

test('escpos: reset, GS v 0 header with LE width-bytes/height, data, feed, full cut', () => {
  const out = new EscPosDriver().encode(black16x1);
  assert.deepEqual(
    [...out],
    [0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 0x02, 0x00, 0x01, 0x00, 0xff, 0xff, 0x1b, 0x64, 0x03, 0x1d, 0x56, 0x00],
  );
});

test('escpos: cut none omits GS V; tall images are split into bands', () => {
  const tall: MonoRaster = { width: 8, height: 1500, data: Buffer.alloc(1500) };
  const out = new EscPosDriver({ cut: 'none' }).encode(tall);
  assert.equal(out.subarray(-2).toString('hex'), '6403'); // ends with ESC d 3, no cut
  const headers = out.toString('hex').match(/1d763000/g) ?? [];
  assert.equal(headers.length, 2);
});

test('escpos: rejects a raster whose length does not match its size', () => {
  assert.throws(() => new EscPosDriver().encode({ width: 16, height: 1, data: Buffer.alloc(1) }));
});

test('zpl: one ^GFA field with hex data', () => {
  const out = new ZplDriver().encode(black16x1).toString('ascii');
  assert.equal(out, '^XA^PW16^LL1^FO0,0^GFA,2,2,2,FFFF^FS^XZ');
});

test('tspl: sizes label in mm and inverts bitmap bits', () => {
  const out = new TsplDriver({ dpi: 203 }).encode({ width: 8, height: 1, data: Buffer.from([0xf0]) });
  const text = out.toString('latin1');
  assert.match(text, /^SIZE 1\.0 mm,0\.1 mm\r\nGAP 2 mm,0 mm\r\n/);
  const at = out.indexOf('BITMAP 0,0,1,1,0,') + 'BITMAP 0,0,1,1,0,'.length;
  assert.equal(out[at], 0x0f);
  assert.ok(text.endsWith('\r\nPRINT 1,1\r\n'));
});

test('tspl: shiftMm moves the bitmap right in head dots', () => {
  const text = new TsplDriver({ dpi: 300, shiftMm: 2 }).encode({ width: 8, height: 1, data: Buffer.from([0xf0]) }).toString('latin1');
  assert.ok(text.includes('BITMAP 24,0,1,1,0,')); // 2 mm at 300 dpi
});

test('epos: image element with base64 raster and a feed cut', () => {
  const xml = new EposDriver().encode(black16x1).toString('utf8');
  assert.match(xml, /<image width="16" height="1" color="color_1" mode="mono">\/\/8=<\/image><cut type="feed"\/>/);
});

test('spooler (Windows): copies to the share with quoted paths, never opening \\\\host\\share as a file', () => {
  assert.deepEqual(windowsCopyArgs('C:\\Users\\A B\\Temp\\label.bin', 'localhost', 'SeznikB15'),
    ['/d', '/s', '/c', '"copy /b "C:\\Users\\A B\\Temp\\label.bin" "\\\\localhost\\SeznikB15""']);
  assert.throws(() => windowsCopyArgs('x', 'localhost', 'bad"name'), /quotes/);
});
