#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { startAgent } from './agent';
import { detectPrinters } from './detect';
import {
  createPrinter,
  listDrivers,
  listTransports,
  registerDriver,
  registerTransport,
  testPattern,
} from './index';
import type { PrinterConfig } from './types';

type NamedPrinters = Record<string, PrinterConfig & { description?: string }>;

interface ConfigFile {
  /** Modules exporting `function (api) { api.registerDriver(...) }`, relative to this file. */
  plugins?: string[];
  printers?: NamedPrinters;
  agent?: { port?: number; allowOrigins?: string[] };
}

const USAGE = `Usage:
  printer-code print <label.png> [more.png ...] [--printer <name>] [--copies N]
  printer-code test  [--printer <name>] [--height DOTS]
  printer-code list                 configured + auto-detected printers
  printer-code detect               only auto-detected (USB / CUPS) printers
  printer-code agent [--port 9123]  run the local print service for kiosk browsers

Options:
  --config <file>   printers config (default: $PRINTER_CONFIG or ./printers.json; optional —
                    without it, locally connected printers are auto-detected)
  --printer <name>  which printer (default: the first configured, else the first detected)`;

function loadConfig(path: string | undefined): ConfigFile {
  const file = resolve(path ?? 'printers.json');
  // An explicitly named config must exist; the default one is optional (zero-config kiosk).
  if (!path && !existsSync(file)) return {};
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as ConfigFile;
  for (const plugin of cfg.plugins ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(resolve(dirname(file), plugin));
    (mod.default ?? mod)({ registerDriver, registerTransport });
  }
  return cfg;
}

/** Configured printers first (so they're the default), then whatever is plugged in now. */
function allPrinters(cfg: ConfigFile): NamedPrinters {
  const printers: NamedPrinters = { ...cfg.printers };
  for (const d of detectPrinters()) {
    printers[d.name] ??= { ...d.config, description: d.description };
  }
  return printers;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', default: process.env.PRINTER_CONFIG },
      printer: { type: 'string' },
      copies: { type: 'string', default: '1' },
      height: { type: 'string', default: '240' },
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...files] = positionals;
  if (!command || values.help) {
    console.log(USAGE);
    return;
  }

  const cfg = loadConfig(values.config);

  if (command === 'detect' || command === 'list') {
    const printers = command === 'detect'
      ? Object.fromEntries(detectPrinters().map((d) => [d.name, { ...d.config, description: d.description }]))
      : allPrinters(cfg);
    const names = Object.keys(printers);
    if (names.length === 0) console.log('No printers found.');
    for (const name of names) {
      const p = printers[name];
      console.log(`${name}\t${p.driver.type} via ${p.transport.type}${p.description ? `\t${p.description}` : ''}`);
    }
    console.log(`\ndrivers: ${listDrivers().join(', ')}\ntransports: ${listTransports().join(', ')}`);
    return;
  }

  if (command === 'agent') {
    const port = Number(values.port ?? cfg.agent?.port ?? 9123);
    startAgent({ port, allowOrigins: cfg.agent?.allowOrigins, getPrinters: () => allPrinters(cfg) }).on(
      'listening',
      () => console.log(`Printer agent on http://127.0.0.1:${port} — printers: ${Object.keys(allPrinters(cfg)).join(', ') || 'none yet'}`),
    );
    return;
  }

  const printers = allPrinters(cfg);
  const names = Object.keys(printers);
  const name = values.printer ?? names[0];
  const printerCfg = name ? printers[name] : undefined;
  if (!printerCfg) throw new Error(`No printer "${name ?? ''}". Have: ${names.join(', ') || 'none (connect one or add printers.json)'}`);
  const printer = createPrinter(printerCfg);

  if (command === 'print') {
    if (files.length === 0) throw new Error('print needs at least one PNG file');
    await printer.print(files.map((f) => readFileSync(f)), Number(values.copies));
    console.log(`Printed ${files.length} label(s) on ${name}`);
  } else if (command === 'test') {
    // 384 dots fits both 58 mm and 80 mm heads, so it is safe on an unknown printer.
    await printer.print(testPattern(printerCfg.widthDots ?? 384, Number(values.height)));
    console.log(`Test pattern sent to ${name}`);
  } else {
    throw new Error(`Unknown command "${command}"\n\n${USAGE}`);
  }
}

main().catch((err: Error) => {
  console.error(`printer-code: ${err.message}`);
  process.exit(1);
});
