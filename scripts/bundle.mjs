// Builds release/ — everything a kiosk needs, with no npm install on the device:
//   printer-agent.js            single-file agent + CLI (Node ≥ 18, any OS/CPU)
//   printer-code.browser.js     browser script, global `PrinterCode` (agent client + WebUSB)
//   install-linux.sh, webusb-linux.sh
import { copyFileSync, mkdirSync } from 'node:fs';

import { build } from 'esbuild';

mkdirSync('release', { recursive: true });

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'release/printer-agent.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logLevel: 'warning',
});

await build({
  entryPoints: ['src/browser.ts'],
  outfile: 'release/printer-code.browser.js',
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  globalName: 'PrinterCode',
  // Drivers use Node's Buffer; ship the small pure-JS polyfill.
  inject: ['scripts/buffer-shim.js'],
  logLevel: 'warning',
});

for (const f of ['install-linux.sh', 'webusb-linux.sh']) copyFileSync(`install/${f}`, `release/${f}`);
console.log('release/ ready');
