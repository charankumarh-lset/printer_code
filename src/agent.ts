import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

import { discoverNetworkPrinters, NetworkPrinter, portOpen, RAW_PORT_MAX, RAW_PORT_MIN, scanNetworks } from './discover';
import { createPrinter } from './index';
import { testPattern } from './mono';
import type { SavedPrinters } from './saved';
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
}

const NETWORK_DRIVERS: AutoDriver[] = ['escpos', 'zpl', 'tspl'];

function summary(name: string, p: NamedPrinter, saved: boolean) {
  const network = p.transport.type === 'tcp' || p.transport.type === 'epos-http';
  return {
    name,
    driver: p.driver.type,
    transport: p.transport.type,
    description: p.description,
    connection: p.connection ?? (network ? 'network' : 'usb'),
    host: network ? (p.transport.host as string | undefined) : undefined,
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
 *   POST /test?printer=                   → prints a test pattern
 *   GET  /discover                        → { ok, printers: [{ host, port, model, driver, saved }], networks: [{ iface, address, cidr }] }
 *   POST /printers/add    { host, port?, connection?, model?, driver? } → checks it answers, then saves it
 *   POST /printers/remove { name }        → removes a saved network printer
 *   GET  /                                → setup page for checking the device
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
        scanning ??= discover().finally(() => (scanning = null));
        const found = await scanning;
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
        const name = `net-${printerHost}${printerPort === RAW_PORT_MIN ? '' : `-${printerPort}`}`;
        const printer: NamedPrinter = {
          driver: { type: driver },
          transport: { type: 'tcp', host: printerHost, port: printerPort },
          description: `${model || 'Network printer'} (${printerHost})`,
          connection: body?.connection === 'wifi' ? 'wifi' : 'ethernet',
        };
        opts.store.set(name, printer);
        return json(res, 200, { ok: true, printer: summary(name, printer, true) });
      }
      if (req.method === 'POST' && url.pathname === '/printers/remove') {
        const body = await readJson(req);
        const name = typeof body?.name === 'string' ? body.name : '';
        if (!opts.store?.remove(name)) return json(res, 404, { ok: false, error: `no saved printer "${name}"` });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(SETUP_PAGE);
      }
      if (req.method === 'POST' && (url.pathname === '/print' || url.pathname === '/test')) {
        const name = url.searchParams.get('printer') || Object.keys(printers)[0];
        const cfg = name ? printers[name] : undefined;
        if (!cfg) return json(res, 404, { ok: false, error: name ? `no printer "${name}"` : 'no printer connected' });

        const label =
          url.pathname === '/test' ? testPattern(cfg.widthDots ?? 384, 240) : await readBody(req);
        const copies = Math.max(1, Math.min(100, Number(url.searchParams.get('copies')) || 1));
        const job = queue.then(() => createPrinter(cfg).print(label, copies));
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

const SETUP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Printer agent</title><style>
body{font:16px system-ui,sans-serif;margin:24px;max-width:640px}button{font-size:16px;padding:8px 14px;margin:4px 0}
li{margin:8px 0}code{background:#eee;padding:1px 4px}#msg{margin-top:12px;font-weight:600}</style></head><body>
<h1>Printer agent is running</h1><p>Connected printers (plug one in and reload):</p><ul id="list"><li>Loading…</li></ul><div id="msg"></div>
<script>
const msg = document.getElementById('msg');
fetch('/status').then(r => r.json()).then(s => {
  const list = document.getElementById('list');
  list.innerHTML = s.printers.length ? '' : '<li>No printer found. Check the USB cable, or add one to printers.json.</li>';
  for (const p of s.printers) {
    const li = document.createElement('li');
    li.innerHTML = '<code></code> <span></span><br><button>Print test page</button>';
    li.querySelector('code').textContent = p.name;
    li.querySelector('span').textContent = p.description || p.driver + ' via ' + p.transport;
    li.querySelector('button').onclick = async () => {
      msg.textContent = 'Printing…';
      const r = await fetch('/test?printer=' + encodeURIComponent(p.name), { method: 'POST' }).then(r => r.json());
      msg.textContent = r.ok ? 'Sent to ' + p.name : 'Failed: ' + r.error;
    };
    list.appendChild(li);
  }
});
</script></body></html>`;
