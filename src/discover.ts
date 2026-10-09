import { execFileSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { NetworkInterfaceInfo, networkInterfaces } from 'node:os';

import { AutoDriver, guessDriver } from './vendors';

export interface NetworkPrinter {
  host: string;
  port: number;
  /** From SNMP when the printer answers it, e.g. "EPSON TM-L100". */
  model?: string;
  /** Hardware address (from the ARP table) — stays the same when the IP changes. */
  mac?: string;
  driver: AutoDriver;
}

/** Raw print ports (9100 = JetDirect/AppSocket). The agent never sends print data anywhere else. */
export const RAW_PORT_MIN = 9100;
export const RAW_PORT_MAX = 9109;

const ipToInt = (ip: string) => ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
const intToIp = (n: number) => [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join('.');

export interface ScanNetwork {
  /** Interface name, e.g. wlan0 / eth0 / en0. */
  iface: string;
  /** This machine's address on it. */
  address: string;
  /** e.g. "192.168.1.0/24" — what is actually scanned. */
  cidr: string;
}

/**
 * Networks to scan: every IPv4 network this machine is on (Ethernet and
 * Wi‑Fi alike), each narrowed to its own /24 so a large office subnet stays a
 * ~2 s scan of 254 hosts instead of minutes.
 */
export function scanNetworks(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): (ScanNetwork & { first: number; size: number; self: number })[] {
  const networks = [];
  for (const [iface, addrs] of Object.entries(interfaces)) {
    for (const a of addrs ?? []) {
      if (!['IPv4', '4'].includes(String(a.family)) || a.internal || a.address.startsWith('169.254.')) continue;
      const ip = ipToInt(a.address);
      const prefix = Math.max(24, a.netmask.split('.').reduce((bits, o) => bits + (Number(o).toString(2).match(/1/g)?.length ?? 0), 0));
      const size = 2 ** (32 - prefix);
      const first = ip - (ip % size);
      networks.push({ iface, address: a.address, cidr: `${intToIp(first)}/${prefix}`, first, size, self: ip });
    }
  }
  return networks;
}

/** Host addresses to probe on those networks (excluding network, broadcast and this machine). */
export function scanTargets(interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const hosts = new Set<string>();
  for (const n of scanNetworks(interfaces)) {
    for (let h = n.first + 1; h < n.first + n.size - 1; h++) if (h !== n.self) hosts.add(intToIp(h));
  }
  return [...hosts];
}

export function portOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// --- Minimal SNMPv1 GET (community "public") to read the printer model ---

const OID_DEVICE_DESCR = [1, 3, 6, 1, 2, 1, 25, 3, 2, 1, 3, 1]; // hrDeviceDescr.1 — e.g. "EPSON TM-L100"
const OID_SYS_DESCR = [1, 3, 6, 1, 2, 1, 1, 1, 0]; // sysDescr.0 — fallback

function tlv(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag, body.length]), body]); // short-form length: requests are < 128 bytes
}

/** OID with every component < 128 (true for the two OIDs above). */
function oidTlv(oid: number[]): Buffer {
  return tlv(0x06, Buffer.from([40 * oid[0] + oid[1], ...oid.slice(2)]));
}

export function snmpGetRequest(oid: number[], requestId: number): Buffer {
  const id = Buffer.alloc(4);
  id.writeInt32BE(requestId);
  const varbind = tlv(0x30, Buffer.concat([oidTlv(oid), Buffer.from([0x05, 0x00])]));
  const pdu = tlv(0xa0, Buffer.concat([tlv(0x02, id), Buffer.from([0x02, 0x01, 0x00, 0x02, 0x01, 0x00]), tlv(0x30, varbind)]));
  return tlv(0x30, Buffer.concat([Buffer.from([0x02, 0x01, 0x00]), tlv(0x04, Buffer.from('public')), pdu]));
}

/** The OCTET STRING value bound to `oid` in a response, or undefined (missing / error / not a string). */
export function parseSnmpString(response: Buffer, oid: number[]): string | undefined {
  const at = response.indexOf(oidTlv(oid));
  if (at < 0) return undefined;
  let i = at + oidTlv(oid).length;
  if (response[i] !== 0x04) return undefined;
  let len = response[i + 1];
  i += 2;
  if (len & 0x80) {
    const bytes = len & 0x7f;
    len = 0;
    for (let k = 0; k < bytes; k++) len = len * 256 + response[i++];
  }
  return response.subarray(i, i + len).toString('utf8').replace(/\0/g, '').trim() || undefined;
}

function snmpGet(host: string, oid: number[], timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const finish = (value?: string) => {
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    socket.on('message', (msg) => finish(parseSnmpString(msg, oid)));
    socket.on('error', () => finish());
    socket.send(snmpGetRequest(oid, Math.floor(Math.random() * 0x7fffffff)), 161, host);
  });
}

export async function printerModel(host: string, timeoutMs = 1000): Promise<string | undefined> {
  const [device, system] = await Promise.all([
    snmpGet(host, OID_DEVICE_DESCR, timeoutMs),
    snmpGet(host, OID_SYS_DESCR, timeoutMs),
  ]);
  return device ?? system;
}

/**
 * Find network printers (Ethernet or Wi‑Fi — same thing at the IP level):
 * every host on this machine's networks with a raw print port open, plus its
 * model via SNMP when available. Takes ~2 s for a /24.
 */
// --- MAC address lookup (ARP table) ---

/** "0:26:ab:1:2:3" / "00-26-AB-01-02-03" → "00:26:ab:01:02:03"; undefined for incomplete/zero entries. */
export function normalizeMac(raw: string): string | undefined {
  const parts = raw.trim().toLowerCase().split(/[:-]/);
  if (parts.length !== 6 || parts.some((p) => !/^[0-9a-f]{1,2}$/.test(p))) return undefined;
  const mac = parts.map((p) => p.padStart(2, '0')).join(':');
  return mac === '00:00:00:00:00:00' ? undefined : mac;
}

/** Find `host`'s MAC in ARP output: Linux /proc/net/arp, macOS `arp -n`, Windows `arp -a`. */
export function parseArp(output: string, host: string): string | undefined {
  for (const line of output.split('\n')) {
    const cols = line.trim().split(/\s+/);
    const at = cols.findIndex((c) => c === host || c === `(${host})`);
    if (at < 0) continue;
    for (const c of cols.slice(at + 1)) {
      const mac = normalizeMac(c);
      if (mac) return mac;
    }
  }
  return undefined;
}

/**
 * MAC of a host on this machine's local network, read from the OS ARP table
 * (populated by any recent connection to it). Undefined for hosts behind a
 * router — their ARP entry would be the router's, so it is never trusted.
 */
export function macFor(host: string): string | undefined {
  try {
    if (process.platform === 'linux') return parseArp(readFileSync('/proc/net/arp', 'utf8'), host);
    const args = process.platform === 'win32' ? ['-a', host] : ['-n', host];
    return parseArp(execFileSync('arp', args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }), host);
  } catch {
    return undefined;
  }
}

export async function discoverNetworkPrinters(
  opts: { hosts?: string[]; ports?: number[]; timeoutMs?: number; concurrency?: number; macFor?: (host: string) => string | undefined } = {},
): Promise<NetworkPrinter[]> {
  const targets = (opts.hosts ?? scanTargets()).flatMap((host) => (opts.ports ?? [9100]).map((port) => ({ host, port })));
  const open: { host: string; port: number }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const t = targets[next++];
      if (await portOpen(t.host, t.port, opts.timeoutMs ?? 400)) open.push(t);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 64, targets.length) }, worker));
  open.sort((a, b) => ipToInt(a.host) - ipToInt(b.host) || a.port - b.port);
  return Promise.all(
    open.map(async (t) => {
      const model = await printerModel(t.host);
      return { ...t, model, mac: (opts.macFor ?? macFor)(t.host), driver: guessDriver({ name: model }) };
    }),
  );
}
