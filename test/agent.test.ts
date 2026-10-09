import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { PNG } from 'pngjs';

import { startAgent } from '../src/agent';
import { parseLpstatDevices } from '../src/detect';
import { guessDriver, isKnownThermal, parseDeviceId, registerTransport } from '../src';

test('parseDeviceId: reads IEEE 1284 fields (short and long keys)', () => {
  assert.deepEqual(parseDeviceId('MFG:EPSON;CMD:ESC/POS;MDL:TM-L100;CLS:PRINTER;'), {
    manufacturer: 'EPSON',
    model: 'TM-L100',
    commandSet: 'ESC/POS',
  });
  assert.equal(parseDeviceId('MANUFACTURER:Zebra;COMMAND SET:ZPL;MODEL:ZD421;').commandSet, 'ZPL');
});

test('guessDriver: command set beats vendor, vendor beats name, default escpos', () => {
  assert.equal(guessDriver({ commandSet: 'ZPL', vendorId: 0x04b8 }), 'zpl');
  assert.equal(guessDriver({ vendorId: 0x1203 }), 'tspl');
  assert.equal(guessDriver({ name: 'Zebra ZD421' }), 'zpl');
  assert.equal(guessDriver({ vendorId: 0x9999 }), 'escpos');
});

test('detect: only USB CUPS queues that look like thermal printers are auto-used', () => {
  const queues = parseLpstatDevices(
    'device for Office_LaserJet: usb://HP/LaserJet%20Pro?serial=1\n' +
      'device for TM_L100: usb://EPSON/TM-L100?serial=X\n' +
      'device for NetPrinter: ipp://10.0.0.5/ipp\n',
  );
  assert.deepEqual(queues, [
    { queue: 'Office_LaserJet', model: 'HP LaserJet Pro' },
    { queue: 'TM_L100', model: 'EPSON TM-L100' },
  ]);
  assert.deepEqual(
    queues.filter((q) => isKnownThermal({ name: `${q.queue} ${q.model}` })).map((q) => q.queue),
    ['TM_L100'],
  );
});

function onePixelPng(): Buffer {
  const img = new PNG({ width: 8, height: 1 });
  img.data.fill(0);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  return PNG.sync.write(img);
}

async function withAgent(fn: (base: string, sent: Buffer[]) => Promise<void>, allowOrigins?: string[]) {
  const sent: Buffer[] = [];
  registerTransport('agent-memory', () => ({ send: async (b) => void sent.push(b) }));
  const server = startAgent({
    port: 0,
    allowOrigins,
    getPrinters: () => ({ kiosk: { driver: { type: 'escpos' }, transport: { type: 'agent-memory' } } }),
  });
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, sent);
  } finally {
    server.close();
  }
}

test('agent: POST /print turns a PNG into one ESC/POS job per copy', () =>
  withAgent(async (base, sent) => {
    const res = await fetch(`${base}/print?copies=2`, { method: 'POST', body: onePixelPng() });
    assert.deepEqual(await res.json(), { ok: true, printer: 'kiosk' });
    assert.equal(sent.length, 2);
    assert.equal(sent[0].subarray(0, 4).toString('hex'), '1b401d76');
    assert.equal(sent[0][10], 0xff); // the all-black row
  }));

test('agent: /status lists printers; unknown printer is a 404', () =>
  withAgent(async (base) => {
    const status = await (await fetch(`${base}/status`)).json();
    assert.equal(status.printers[0].name, 'kiosk');
    const res = await fetch(`${base}/print?printer=nope`, { method: 'POST', body: onePixelPng() });
    assert.equal(res.status, 404);
  }));

test('agent: CORS preflight allows Private Network Access; other origins are refused', () =>
  withAgent(
    async (base) => {
      const pre = await fetch(`${base}/print`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://kitchen.example', 'Access-Control-Request-Private-Network': 'true' },
      });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
      assert.equal(pre.headers.get('access-control-allow-origin'), 'https://kitchen.example');

      const evil = await fetch(`${base}/status`, { headers: { Origin: 'https://evil.example' } });
      assert.equal(evil.status, 403);
    },
    ['https://kitchen.example'],
  ));

test('agent: rejects requests whose Host is not localhost (DNS rebinding)', () =>
  withAgent(async (base) => {
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/status`, { headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  }));
