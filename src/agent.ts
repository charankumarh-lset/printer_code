import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

import { installedPrinters, InstalledList } from './detect';
import { discoverNetworkPrinters, macFor, NetworkPrinter, portOpen, RAW_PORT_MAX, RAW_PORT_MIN, scanNetworks } from './discover';
import { createPrinter } from './index';
import { testPattern } from './mono';
import type { SavedPrinters } from './saved';
import { setupPage } from './setup-page';
import type { NamedPrinter } from './types';
import { AutoDriver, guessDriver } from './vendors';

export interface AgentOptions {
  /** Default 127.0.0.1 — only the kiosk itself can reach the agent. */
  host?: string;
  port?: number;
  /** Web origins allowed to print, e.g. ["https://kitchen.example.com"]. Default ["*"]. */
  allowOrigins?: string[];
  /** Called per request, so hot-plugged printers show up without a restart. */
  getPrinters: () => Record<string, NamedPrinter>;
  /** Where network printers connected from the app are kept. Without it, add/remove are unavailable. */
  store?: SavedPrinters;
  /** Network scan; injectable for tests. Default: discoverNetworkPrinters(). */
  discover?: () => Promise<NetworkPrinter[]>;
  /** ARP lookup; injectable for tests. Default: macFor(). */
  macFor?: (host: string) => string | undefined;
  /** Printers installed in the OS; injectable for tests. Default: installedPrinters(). */
  installed?: () => Promise<InstalledList>;
}

const NETWORK_DRIVERS: AutoDriver[] = ['escpos', 'zpl', 'tspl'];
/** Label-printer actions for a jam or a new roll (TSPL immediate setup commands). */
const TSPL_COMMANDS = { '/feed': 'FORMFEED\r\n', '/calibrate': 'GAPDETECT\r\n' } as Record<string, string>;
const HEAD_DPIS = [203, 300];

function summary(name: string, p: NamedPrinter, saved: boolean) {
  const network = p.transport.type === 'tcp' || p.transport.type === 'epos-http';
  return {
    name,
    driver: p.driver.type,
    transport: p.transport.type,
    description: p.description,
    connection: p.connection ?? (network ? 'network' : 'usb'),
    host: network ? (p.transport.host as string | undefined) : undefined,
    mac: p.mac,
    shiftMm: p.shiftMm,
    saved,
  };
}

/** Parse a small JSON request body; null when it isn't a JSON object. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse((await readBody(req)).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const MAX_BODY = 10 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('label image too large (max 10 MB)'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Local print agent. The kiosk page POSTs a label PNG to
 * http://127.0.0.1:<port>/print and the agent prints it on a local printer.
 *
 *   GET  /status                          → { ok, printers: [{ name, driver, transport, description, connection, host, saved }] }
 *   POST /print?printer=&copies=  (PNG)   → { ok } — printer defaults to the first one
 *   POST /test?printer=                   → prints an alignment pattern (the setup page prints a sample label via /print)
 *   GET  /discover                        → { ok, printers: [{ host, port, model, driver, saved }], networks: [{ iface, address, cidr }] }
 *   POST /printers/add    { host, port?, connection?, model?, driver? } → checks it answers, then saves it
 *   GET  /installed                       → { ok, printers: [{ name, driverName, port, thermal, driver, dpi, available, saved }], error? }
 *                                           every printer installed in the OS, thermal ones first
 *   POST /printers/add-installed { printer, driver, dpi? } → saves an installed printer with the chosen language
 *   POST /printers/shift { name, shiftMm } → saves how far right (0–10 mm) to move this TSPL printer's labels
 *   POST /feed?printer=                   → TSPL: feeds one blank label (after a jam or a folded label)
 *   POST /calibrate?printer=              → TSPL: re-detects the label gap (after loading a new roll)
 *   POST /printers/remove { name }        → removes a saved printer
 *   GET  /                                → setup page: label size/copies, preview, print a sample kiosk label
 */
export function startAgent(opts: AgentOptions): Server {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 9123;
  const allow = opts.allowOrigins ?? ['*'];
  // One job at a time: two tabs printing at once must not interleave bytes on one device.
  let queue: Promise<unknown> = Promise.resolve();
  // Share one scan between concurrent requests (e.g. two tabs pressing Find).
  let scanning: Promise<NetworkPrinter[]> | null = null;
  const discover = opts.discover ?? (() => discoverNetworkPrinters());
  const lookupMac = opts.macFor ?? macFor;
  const listInstalled = opts.installed ?? installedPrinters;
  const scan = () => (scanning ??= discover().finally(() => (scanning = null)));

  /**
   * A saved network printer is identified by its MAC, not its IP: DHCP can
   * hand it a new address, or hand its old address to another device. Before
   * printing, confirm the saved IP still reaches the same printer; otherwise
   * rescan, follow the MAC to its new IP and save it. Never print elsewhere.
   */
  const locate = async (name: string, p: NamedPrinter): Promise<NamedPrinter> => {
    const host = p.transport.host as string;
    const port = (p.transport.port as number | undefined) ?? RAW_PORT_MIN;
    if (await portOpen(host, port, 1500)) {
      const seen = lookupMac(host);
      if (!seen || seen === p.mac) return p; // same printer (or MAC unreadable — keep the fixed address)
    }
    const found = (await scan()).filter((f) => f.mac === p.mac);
    const match = found.find((f) => f.port === port) ?? found[0];
    if (!match) {
      throw new Error(`${p.description ?? name} was not found on this network (MAC ${p.mac}). Check it is on and connected to the same network.`);
    }
    const moved: NamedPrinter = {
      ...p,
      transport: { ...p.transport, host: match.host, port: match.port },
      description: (p.description ?? 'Network printer').replace(/\([^)]*\)$/, `(${match.host})`),
    };
    opts.store?.set(name, moved);
    return moved;
  };

  const server = createServer(async (req, res) => {
    // Block DNS-rebinding: a remote page must not reach us under its own hostname.
    const hostname = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return json(res, 403, { ok: false, error: 'bad host' });

    const origin = req.headers.origin;
    const originAllowed = !origin || allow.includes('*') || allow.includes(origin);
    if (origin && originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        // Chrome Private Network Access: lets an https site call this localhost service.
        'Access-Control-Allow-Private-Network': 'true',
      });
      return res.end();
    }
    if (!originAllowed) return json(res, 403, { ok: false, error: `origin ${origin} not allowed` });

    const url = new URL(req.url ?? '/', 'http://agent');
    try {
      const printers = opts.getPrinters();
      const saved = opts.store?.list() ?? {};
      if (req.method === 'GET' && url.pathname === '/status') {
        return json(res, 200, {
          ok: true,
          printers: Object.entries(printers).map(([name, p]) => summary(name, p, name in saved)),
        });
      }
      if (req.method === 'GET' && url.pathname === '/discover') {
        const found = await scan();
        const savedHosts = new Set(Object.values(saved).map((p) => `${p.transport.host}:${p.transport.port}`));
        return json(res, 200, {
          ok: true,
          printers: found.map((p) => ({ ...p, saved: savedHosts.has(`${p.host}:${p.port}`) })),
          // What was searched, so a printer on a different network (e.g. wired vs Wi‑Fi VLAN) is diagnosable.
          networks: scanNetworks().map(({ iface, address, cidr }) => ({ iface, address, cidr })),
        });
      }
      if (req.method === 'POST' && url.pathname === '/printers/add') {
        if (!opts.store) return json(res, 501, { ok: false, error: 'this agent cannot save printers' });
        const body = await readJson(req);
        const printerHost = typeof body?.host === 'string' ? body.host.trim() : '';
        const printerPort = body?.port === undefined ? RAW_PORT_MIN : Number(body.port);
        if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(printerHost)) {
          return json(res, 400, { ok: false, error: 'Enter a valid printer IP address or hostname' });
        }
        // Only raw print ports: the agent must not become a way to push bytes to other LAN services.
        if (!Number.isInteger(printerPort) || printerPort < RAW_PORT_MIN || printerPort > RAW_PORT_MAX) {
          return json(res, 400, { ok: false, error: `Port must be ${RAW_PORT_MIN}–${RAW_PORT_MAX}` });
        }
        if (!(await portOpen(printerHost, printerPort, 2000))) {
          return json(res, 400, { ok: false, error: `No printer answered at ${printerHost}:${printerPort}` });
        }
        const model = typeof body?.model === 'string' ? body.model.slice(0, 80) : undefined;
        const driver = NETWORK_DRIVERS.includes(body?.driver as AutoDriver)
          ? (body?.driver as AutoDriver)
          : guessDriver({ name: model });
        // Name by MAC when known so the name (and this station's selection) survives IP changes.
        const mac = lookupMac(printerHost);
        const name = `net-${mac ? mac.replace(/:/g, '') : printerHost}${printerPort === RAW_PORT_MIN ? '' : `-${printerPort}`}`;
        const printer: NamedPrinter = {
          driver: { type: driver },
          transport: { type: 'tcp', host: printerHost, port: printerPort },
          description: `${model || 'Network printer'} (${printerHost})`,
          connection: body?.connection === 'wifi' ? 'wifi' : 'ethernet',
          ...(mac ? { mac } : {}),
        };
        opts.store.set(name, printer);
        return json(res, 200, { ok: true, printer: summary(name, printer, true) });
      }
      if (req.method === 'GET' && url.pathname === '/installed') {
        const { printers: installed, error } = await listInstalled();
        const usable = new Set(Object.values(printers).filter((p) => p.transport.type === 'winspool').map((p) => p.transport.printer));
        return json(res, 200, {
          ok: true,
          printers: installed.map((p) => ({ ...p, available: usable.has(p.name), saved: p.name in saved })),
          ...(error ? { error } : {}),
        });
      }
      if (req.method === 'POST' && url.pathname === '/printers/add-installed') {
        if (!opts.store) return json(res, 501, { ok: false, error: 'this agent cannot save printers' });
        const body = await readJson(req);
        // Only printers the OS actually has: never let a page invent a spooler name.
        const found = (await listInstalled()).printers.find((p) => p.name === body?.printer);
        if (!found) return json(res, 404, { ok: false, error: `No installed printer "${String(body?.printer ?? '')}"` });
        if (!NETWORK_DRIVERS.includes(body?.driver as AutoDriver)) {
          return json(res, 400, { ok: false, error: `Language must be one of ${NETWORK_DRIVERS.join(', ')}` });
        }
        const dpi = body?.dpi === undefined ? found.dpi : Number(body.dpi);
        if (!HEAD_DPIS.includes(dpi)) return json(res, 400, { ok: false, error: `dpi must be ${HEAD_DPIS.join(' or ')}` });
        const driver = body?.driver as AutoDriver;
        const printer: NamedPrinter = {
          driver: { type: driver },
          transport: { type: 'winspool', printer: found.name },
          dpi,
          description: `${found.driverName ?? found.name} (Windows printer on ${found.port ?? 'unknown port'}, ${driver})`,
          connection: /^USB/i.test(found.port ?? '') ? 'usb' : 'network',
        };
        opts.store.set(found.name, printer);
        return json(res, 200, { ok: true, printer: summary(found.name, printer, true) });
      }
      if (req.method === 'POST' && url.pathname === '/printers/shift') {
        if (!opts.store) return json(res, 501, { ok: false, error: 'this agent cannot save printers' });
        const body = await readJson(req);
        const name = typeof body?.name === 'string' ? body.name : '';
        const printer = printers[name];
        if (!printer) return json(res, 404, { ok: false, error: `no printer "${name}"` });
        if (printer.driver.type !== 'tspl') return json(res, 400, { ok: false, error: 'Only TSPL label printers can be shifted' });
        const shiftMm = Number(body?.shiftMm);
        if (!Number.isFinite(shiftMm) || shiftMm < 0 || shiftMm > 10) return json(res, 400, { ok: false, error: 'Shift must be 0–10 mm' });
        // Saving a detected printer pins its current config; removing it returns to detection.
        const shifted: NamedPrinter = { ...printer, shiftMm: Math.round(shiftMm * 10) / 10 };
        opts.store.set(name, shifted);
        return json(res, 200, { ok: true, printer: summary(name, shifted, true) });
      }
      if (req.method === 'POST' && url.pathname === '/printers/remove') {
        const body = await readJson(req);
        const name = typeof body?.name === 'string' ? body.name : '';
        if (!opts.store?.remove(name)) return json(res, 404, { ok: false, error: `no saved printer "${name}"` });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(setupPage());
      }
      if (req.method === 'POST' && url.pathname in TSPL_COMMANDS) {
        const name = url.searchParams.get('printer') ?? '';
        let cfg = printers[name];
        if (!cfg) return json(res, 404, { ok: false, error: `no printer "${name}"` });
        if (cfg.driver.type !== 'tspl') return json(res, 400, { ok: false, error: 'Feed and calibrate are available for TSPL label printers only' });
        if (name in saved && cfg.mac && cfg.transport.type === 'tcp') cfg = await locate(name, cfg);
        console.log(`${new Date().toISOString()} ${url.pathname.slice(1)} printer=${name} from=${req.headers.referer ?? origin ?? 'direct'}`);
        const target = cfg;
        const job = queue.then(() => createPrinter(target, name).transport.send(Buffer.from(TSPL_COMMANDS[url.pathname], 'ascii')));
        queue = job.catch(() => undefined);
        await job;
        return json(res, 200, { ok: true, printer: name });
      }
      if (req.method === 'POST' && (url.pathname === '/print' || url.pathname === '/test')) {
        const name = url.searchParams.get('printer') || Object.keys(printers)[0];
        let cfg = name ? printers[name] : undefined;
        if (!cfg) return json(res, 404, { ok: false, error: name ? `no printer "${name}"` : 'no printer connected' });
        if (name in saved && cfg.mac && cfg.transport.type === 'tcp') cfg = await locate(name, cfg);

        const label =
          url.pathname === '/test' ? testPattern(cfg.widthDots ?? 384, 240) : await readBody(req);
        const copies = Math.max(1, Math.min(100, Number(url.searchParams.get('copies')) || 1));
        // One line per job (journalctl / agent.log) so "why did N labels print?" is answerable.
        console.log(
          `${new Date().toISOString()} ${url.pathname.slice(1)} printer=${name} copies=${copies}` +
            `${Buffer.isBuffer(label) ? ` bytes=${label.length}` : ''} from=${req.headers.referer ?? origin ?? 'direct'}`,
        );
        const job = queue.then(() => createPrinter(cfg, name).print(label, copies));
        queue = job.catch(() => undefined);
        await job;
        return json(res, 200, { ok: true, printer: name });
      }
      return json(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      return json(res, 500, { ok: false, error: (err as Error).message });
    }
  });

  server.listen(port, host);
  return server;
}
