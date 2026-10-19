import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { AddressInfo, createServer, Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { startAgent } from '../src/agent';
import { discoverNetworkPrinters, normalizeMac, parseArp, parseSnmpString, scanTargets, snmpGetRequest } from '../src/discover';
import type { NetworkPrinter } from '../src/discover';
import { SavedPrinters } from '../src/saved';

test('scanTargets: whole network up to a /21, narrows bigger ones, skips loopback/link-local', () => {
  const iface = (address: string, netmask: string, internal = false) => ({
    address, netmask, family: 'IPv4' as const, internal, mac: '', cidr: null,
  });
  const hosts = scanTargets({
    en0: [iface('192.168.1.20', '255.255.255.0')],
    en1: [iface('10.5.7.9', '255.255.0.0')], // a /16 office network → only the /21 around it: 10.5.0.0–10.5.7.255
    lo0: [iface('127.0.0.1', '255.0.0.0', true)],
    awdl: [iface('169.254.3.3', '255.255.0.0')],
  });
  assert.equal(hosts.length, 253 + 2045);
  assert.ok(hosts.includes('192.168.1.1') && hosts.includes('192.168.1.254'));
  assert.ok(!hosts.includes('192.168.1.20') && !hosts.includes('192.168.1.0') && !hosts.includes('192.168.1.255'));
  assert.ok(hosts.includes('10.5.0.1') && hosts.includes('10.5.7.254') && !hosts.includes('10.5.8.1'));

  const office = scanTargets({ en0: [iface('100.3.20.242', '255.255.248.0')] }); // a real /21
  assert.equal(office.length, 2045);
  assert.ok(office.includes('100.3.16.1') && office.includes('100.3.23.254') && !office.includes('100.3.20.242'));
  assert.ok(!hosts.some((h) => h.startsWith('127.') || h.startsWith('169.254.')));

  const small = scanTargets({ en0: [iface('192.168.1.20', '255.255.255.248')] }); // /29
  assert.deepEqual(small, ['192.168.1.17', '192.168.1.18', '192.168.1.19', '192.168.1.21', '192.168.1.22']);
});

test('snmp: request encodes a v1 GET for the OID; response string is extracted', () => {
  const oid = [1, 3, 6, 1, 2, 1, 1, 1, 0];
  const req = snmpGetRequest(oid, 1);
  assert.equal(req.toString('hex'), '302902010004067075626c6963a01c020400000001020100020100300e300c06082b060102010101000500');

  const value = Buffer.from('EPSON TM-L100');
  const response = Buffer.concat([
    Buffer.from('3036020100040670756269636ca2290204000000010201000201003019301706082b06010201010100', 'hex'),
    Buffer.from([0x04, value.length]),
    value,
  ]);
  assert.equal(parseSnmpString(response, oid), 'EPSON TM-L100');
  // noSuchName → value is NULL, not a string
  assert.equal(parseSnmpString(Buffer.from('06082b060102010101000500', 'hex'), oid), undefined);
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

test('discoverNetworkPrinters: finds hosts with the print port open', async () => {
  const printer = createServer((s) => s.end());
  const port = await listen(printer);
  try {
    const found = await discoverNetworkPrinters({ hosts: ['127.0.0.1'], ports: [port, 1], timeoutMs: 300 });
    assert.equal(found.length, 1);
    assert.equal(found[0].host, '127.0.0.1');
    assert.equal(found[0].port, port);
    assert.equal(found[0].driver, 'escpos');
  } finally {
    printer.close();
  }
});

async function withAgent(fn: (base: string, store: SavedPrinters) => Promise<void>, macFor?: (host: string) => string | undefined) {
  const store = new SavedPrinters(join(mkdtempSync(join(tmpdir(), 'printer-net-')), 'saved.json'));
  const server = startAgent({
    port: 0,
    store,
    getPrinters: () => store.list(),
    discover: async () => [{ host: '192.168.1.50', port: 9100, model: 'EPSON TM-L100', driver: 'escpos' }],
    macFor: macFor ?? (() => undefined),
  });
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, store);
  } finally {
    server.close();
  }
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('agent: /discover returns the scan', () =>
  withAgent(async (base) => {
    const body = await (await fetch(`${base}/discover`)).json();
    assert.deepEqual(body.printers, [
      { host: '192.168.1.50', port: 9100, model: 'EPSON TM-L100', driver: 'escpos', saved: false },
    ]);
  }));

test('agent: add only accepts raw print ports and hosts that answer', () =>
  withAgent(async (base) => {
    let res = await post(`${base}/printers/add`, { host: '127.0.0.1', port: 22 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /9100/);

    res = await post(`${base}/printers/add`, { host: 'bad host!' });
    assert.equal(res.status, 400);

    res = await post(`${base}/printers/add`, { host: '127.0.0.1', port: 9109 }); // nothing listening there
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /No printer answered/);
  }));

test('agent: add saves a reachable printer (persisted), status shows it, remove deletes it', () =>
  withAgent(async (base, store) => {
    // Port range is enforced, so run a fake printer on 9100..9109 if one is free.
    const printer = createServer((s) => s.end());
    let port = 0;
    for (let p = 9100; p <= 9109 && !port; p++) {
      port = await new Promise<number>((resolve) => {
        printer.once('error', () => resolve(0));
        printer.listen(p, '127.0.0.1', () => resolve(p));
      });
    }
    if (!port) return; // all raw ports busy on this machine; skip
    try {
      const res = await post(`${base}/printers/add`, { host: '127.0.0.1', port, connection: 'wifi', model: 'Zebra ZD421' });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      const name = body.printer.name;
      assert.equal(body.printer.connection, 'wifi');
      assert.equal(body.printer.driver, 'zpl');
      assert.equal(store.list()[name].transport.port, port);

      const status = await (await fetch(`${base}/status`)).json();
      assert.deepEqual(
        status.printers.map((p: { name: string; connection: string; saved: boolean; host: string }) => [p.name, p.connection, p.saved, p.host]),
        [[name, 'wifi', true, '127.0.0.1']],
      );

      assert.equal((await post(`${base}/printers/remove`, { name })).status, 200);
      assert.deepEqual(store.list(), {});
      assert.equal((await post(`${base}/printers/remove`, { name })).status, 404);
    } finally {
      printer.close();
    }
  }));

test('agent: /installed lists every OS printer; add-installed saves one with the chosen language', async () => {
  const store = new SavedPrinters(join(mkdtempSync(join(tmpdir(), 'printer-win-')), 'saved.json'));
  const installed = [
    { name: 'Printer 2', driverName: 'Generic / Text Only', port: 'USB002', thermal: false, driver: 'escpos' as const, dpi: 203 },
  ];
  const server = startAgent({ port: 0, store, getPrinters: () => store.list(), installed: async () => ({ printers: installed }) });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    let body = await (await fetch(`${base}/installed`)).json();
    assert.deepEqual(body.printers.map((p: { name: string; available: boolean; saved: boolean }) => [p.name, p.available, p.saved]), [['Printer 2', false, false]]);

    // Unknown printer names, languages and dpis are refused.
    assert.equal((await post(`${base}/printers/add-installed`, { printer: 'Nope', driver: 'tspl' })).status, 404);
    assert.equal((await post(`${base}/printers/add-installed`, { printer: 'Printer 2', driver: 'pcl' })).status, 400);
    assert.equal((await post(`${base}/printers/add-installed`, { printer: 'Printer 2', driver: 'tspl', dpi: 150 })).status, 400);

    const res = await post(`${base}/printers/add-installed`, { printer: 'Printer 2', driver: 'tspl', dpi: 300 });
    assert.equal(res.status, 200);
    assert.deepEqual(store.list()['Printer 2'], {
      driver: { type: 'tspl' },
      transport: { type: 'winspool', printer: 'Printer 2' },
      dpi: 300,
      description: 'Generic / Text Only (Windows printer on USB002, tspl)',
      connection: 'usb',
    });
    body = await (await fetch(`${base}/installed`)).json();
    assert.deepEqual([body.printers[0].available, body.printers[0].saved], [true, true]);
  } finally {
    server.close();
  }
});

test('agent: /installed passes on why listing failed', async () => {
  const server = startAgent({ port: 0, getPrinters: () => ({}), installed: async () => ({ printers: [], error: 'Could not list Windows printers (Get-Printer timed out after 20 s).' }) });
  await new Promise((r) => server.once('listening', r));
  try {
    const body = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/installed`)).json();
    assert.match(body.error, /timed out/);
  } finally {
    server.close();
  }
});

// --- Following a printer by MAC when its IP changes ---

test('parseArp: reads the MAC for a host from Linux, macOS and Windows ARP output', () => {
  const linux =
    'IP address       HW type     Flags       HW address            Mask     Device\n' +
    '192.168.1.50     0x1         0x2         00:26:ab:12:34:56     *        wlan0\n' +
    '192.168.1.51     0x1         0x0         00:00:00:00:00:00     *        wlan0\n';
  assert.equal(parseArp(linux, '192.168.1.50'), '00:26:ab:12:34:56');
  assert.equal(parseArp(linux, '192.168.1.51'), undefined); // incomplete entry
  assert.equal(parseArp('? (192.168.1.50) at 0:26:ab:2:3:4 on en0 ifscope [ethernet]', '192.168.1.50'), '00:26:ab:02:03:04');
  assert.equal(parseArp('? (192.168.1.50) at (incomplete) on en0 ifscope [ethernet]', '192.168.1.50'), undefined);
  assert.equal(parseArp('  192.168.1.50          00-26-AB-12-34-56     dynamic', '192.168.1.50'), '00:26:ab:12:34:56');
  assert.equal(parseArp('  192.168.1.5           00-26-ab-12-34-99     dynamic', '192.168.1.50'), undefined); // prefix ≠ match
  assert.equal(normalizeMac('nope'), undefined);
});

const MAC = 'aa:bb:cc:dd:ee:ff';

async function fakePrinter(): Promise<{ port: number; received: Buffer[]; close: () => void }> {
  const received: Buffer[] = [];
  const server = createServer((s) => s.on('data', (d) => received.push(d)).on('end', () => s.end()));
  const port = await listen(server);
  return { port, received, close: () => server.close() };
}

async function closedPort(): Promise<number> {
  const s = createServer();
  const port = await listen(s);
  await new Promise((r) => s.close(r));
  return port;
}

async function withMacAgent(
  setup: { saved: { host: string; port: number }; found: NetworkPrinter[]; macAt: (host: string) => string | undefined },
  fn: (base: string, store: SavedPrinters) => Promise<void>,
) {
  const store = new SavedPrinters(join(mkdtempSync(join(tmpdir(), 'printer-mac-')), 'saved.json'));
  store.set('net-aabbccddeeff', {
    driver: { type: 'zpl' },
    transport: { type: 'tcp', host: setup.saved.host, port: setup.saved.port },
    description: `Zebra ZD421 (${setup.saved.host})`,
    connection: 'ethernet',
    mac: MAC,
  });
  const server = startAgent({ port: 0, store, getPrinters: () => store.list(), discover: async () => setup.found, macFor: setup.macAt });
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, store);
  } finally {
    server.close();
  }
}

const printTest = (base: string) => fetch(`${base}/test?printer=net-aabbccddeeff`, { method: 'POST' });

test('agent: printer got a new IP → rescans, follows its MAC, prints there and saves the new address', async () => {
  const printer = await fakePrinter();
  const oldPort = await closedPort(); // the old address no longer answers
  try {
    await withMacAgent(
      {
        saved: { host: '127.0.0.1', port: oldPort },
        found: [{ host: '127.0.0.1', port: printer.port, mac: MAC, driver: 'zpl' }],
        macAt: () => MAC,
      },
      async (base, store) => {
        const res = await printTest(base);
        assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
        assert.match(Buffer.concat(printer.received).toString(), /^\^XA/);
        assert.equal(store.list()['net-aabbccddeeff'].transport.port, printer.port);
      },
    );
  } finally {
    printer.close();
  }
});

test('agent: its old IP now belongs to another device → does not print there, finds the right printer by MAC', async () => {
  const stranger = await fakePrinter();
  const printer = await fakePrinter();
  try {
    await withMacAgent(
      {
        saved: { host: '127.0.0.1', port: stranger.port },
        found: [{ host: '127.0.0.1', port: printer.port, mac: MAC, driver: 'zpl' }],
        macAt: () => '11:22:33:44:55:66', // whatever answers at the saved IP is not our printer
      },
      async (base) => {
        assert.equal((await printTest(base)).status, 200);
        assert.equal(stranger.received.length, 0);
        assert.ok(printer.received.length > 0);
      },
    );
  } finally {
    stranger.close();
    printer.close();
  }
});

test('agent: printer gone from the network → clear error, nothing printed anywhere', async () => {
  const other = await fakePrinter();
  try {
    await withMacAgent(
      {
        saved: { host: '127.0.0.1', port: await closedPort() },
        found: [{ host: '127.0.0.1', port: other.port, mac: '11:22:33:44:55:66', driver: 'escpos' }],
        macAt: () => undefined,
      },
      async (base) => {
        const res = await printTest(base);
        assert.equal(res.status, 500);
        assert.match((await res.json()).error, /not found on this network \(MAC aa:bb:cc:dd:ee:ff\)/);
        assert.equal(other.received.length, 0);
      },
    );
  } finally {
    other.close();
  }
});

test('agent: connecting records the MAC and names the printer by it, so the name survives IP changes', async () => {
  const printer = createServer((s) => s.end());
  let port = 0;
  for (let p = 9100; p <= 9109 && !port; p++) {
    port = await new Promise<number>((resolve) => {
      printer.once('error', () => resolve(0));
      printer.listen(p, '127.0.0.1', () => resolve(p));
    });
  }
  if (!port) return; // all raw ports busy on this machine; skip
  try {
    await withAgent(async (base, store) => {
      const body = await (await post(`${base}/printers/add`, { host: '127.0.0.1', port })).json();
      assert.equal(body.printer.name, `net-0026ab123456${port === 9100 ? '' : `-${port}`}`);
      assert.equal(body.printer.mac, '00:26:ab:12:34:56');
      assert.equal(store.list()[body.printer.name].mac, '00:26:ab:12:34:56');
    }, () => '00:26:ab:12:34:56');
  } finally {
    printer.close();
  }
});

test('agent: /printers/shift saves a TSPL printer with its shift; others and bad values are refused', async () => {
  const store = new SavedPrinters(join(mkdtempSync(join(tmpdir(), 'printer-shift-')), 'saved.json'));
  const detected = {
    seznik: { driver: { type: 'tspl' }, transport: { type: 'winspool', printer: 'Seznik B15' }, description: 'Seznik B15' },
    epson: { driver: { type: 'escpos' }, transport: { type: 'winspool', printer: 'EPSON' } },
  };
  const server = startAgent({ port: 0, store, getPrinters: () => ({ ...detected, ...store.list() }) });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await post(`${base}/printers/shift`, { name: 'nope', shiftMm: 2 })).status, 404);
    assert.equal((await post(`${base}/printers/shift`, { name: 'epson', shiftMm: 2 })).status, 400);
    assert.equal((await post(`${base}/printers/shift`, { name: 'seznik', shiftMm: 11 })).status, 400);
    const res = await post(`${base}/printers/shift`, { name: 'seznik', shiftMm: 2.5 });
    assert.equal(res.status, 200);
    assert.deepEqual(store.list().seznik, { ...detected.seznik, shiftMm: 2.5 });
    const status = await (await fetch(`${base}/status`)).json();
    assert.equal(status.printers.find((p: { name: string }) => p.name === 'seznik').shiftMm, 2.5);
  } finally {
    server.close();
  }
});
