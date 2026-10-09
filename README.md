# printer-code

Prints label/receipt images on thermal printers from any machine that runs
Node.js ≥ 18: Linux (x64, **Jetson** arm64, **Raspberry Pi** arm64/armv7),
Windows and macOS. It's pure JavaScript with one dependency (`pngjs`) and no
native modules, so the same code and config work everywhere.

Extracted from the Antz Kitchen label printing code
(`antz_kitchen_backend/src/inventory/labels`, `antz_kitchen_admin/src/lib/eposPrint.ts`).

## How it works

```
 label.png ──► pngToMono() ──► Driver (printer language) ──► Transport (delivery) ──► printer
               1-bit raster     escpos | zpl | tspl | epos     tcp | device | spooler | epos-http
```

Every label is printed as an image. That means any layout you can render to a
PNG (QR codes, logos, any language or script) prints the same on every printer
brand. You don't need to learn each brand's text and font commands.

The **driver** and the **transport** are independent, so you can combine any
driver with any transport (except `epos`, which only works with `epos-http`).

### Built-in drivers

| type     | Printers                                                        | Options |
|----------|-----------------------------------------------------------------|---------|
| `escpos` | Epson TM, and most generic 58/80 mm thermal printers (Xprinter, Rongta, HPRT, Bixolon…) | `cut`: `full`\|`partial`\|`none`, `feedLines` |
| `zpl`    | Zebra and ZPL-compatible label printers                         | – |
| `tspl`   | TSC and TSPL-compatible label printers                          | `dpi` (203), `gapMm` (2) |
| `epos`   | Epson TM with ePOS-Print enabled (e.g. TM-L100). Use with `epos-http` | – |

### Built-in transports

| type        | Use for                                          | Options |
|-------------|--------------------------------------------------|---------|
| `tcp`       | Any network printer on raw port 9100. **Most portable, try this first.** | `host`, `port` (9100), `timeoutMs` |
| `device`    | Linux USB `/dev/usb/lp0`, serial `/dev/ttyUSB0`, Bluetooth SPP `/dev/rfcomm0`, Windows share `\\localhost\Name`, or a `.bin` file for dry runs | `path` |
| `spooler`   | A printer already installed in the OS: CUPS on Linux/macOS (`lp -o raw`), shared printer on Windows | `queue`, `host` (Windows) |
| `epos-http` | Epson ePOS-Print web service on the printer       | `host`, `port`, `ssl`, `devid` (`local_printer`), `timeoutMs` |

## Kiosk: local printing from the browser (Pi, Jetson, any PC)

A kiosk browser cannot send raw bytes to a USB printer on its own. There are two
paths, and `printLabels()` in the browser script tries them in this order:

```
 kiosk web page ──► printer-code.browser.js ──┬─► 1. local agent  http://127.0.0.1:9123 ──► USB / CUPS / network printer
                                              └─► 2. WebUSB (Chrome) ─────────────────────► USB printer
```

### 1. Local agent (recommended)

Build once on a dev machine, then copy one folder to each kiosk. The kiosk
needs no npm install, no CUPS and no printer driver.

```bash
npm install && npm run bundle          # dev machine → release/
scp -r release pi@kiosk:~/printer-agent
ssh pi@kiosk 'sudo ~/printer-agent/install-linux.sh'                     # Linux; on macOS: ./install-macos.sh (no sudo)
```

`install-linux.sh` installs Node 18+ if it's missing. It then registers the
agent as a systemd service that starts on boot and restarts if it crashes. The
service runs as an unprivileged user in the `lp` group. Plug in the USB
printer, then open **http://127.0.0.1:9123** on the kiosk to see it and
print a test page.

**Auto-detection** happens on every request, so a printer plugged in later shows up without a restart:
- **Linux** `/dev/usb/lp*`: the language comes from the printer's IEEE 1284 ID (`CMD:ESC/POS`, `ZPL`, `TSPL`), then its USB vendor ID, then the ESC/POS default.
- **Linux/macOS** CUPS queues on `usb://` that look like thermal printers. Office printers are skipped.
- **macOS** newly plugged-in USB thermal printers are added to CUPS automatically (checked at most every 5 s).
- **Override or add printers** (network, Windows, unusual models) in `/etc/printer-agent/printers.json`. Configured printers come first and become the default.

**HTTP API** (bound to 127.0.0.1 only):

| Call | Does |
|---|---|
| `GET /status` | `{ ok, printers: [{ name, driver, transport, description, connection, host, saved }] }` |
| `POST /print?printer=&copies=` (body: PNG) | prints one label; `printer` defaults to the first |
| `POST /test?printer=` | prints a test pattern |
| `GET /discover` | scans for network printers: `{ ok, printers: [{ host, port, model, driver, saved }] }` |
| `POST /printers/add` `{ host, port?, connection?, model?, driver? }` | checks the printer answers, then saves it |
| `POST /printers/remove` `{ name }` | removes a printer saved with `add` |
| `GET /` | setup page |

**Ethernet and Wi‑Fi printers.** Once a printer is on the network, it is
reached by IP address either way, so both use the same discovery and
printing. The only Wi‑Fi-specific step is joining the printer to the Wi‑Fi
network in the first place, with the vendor's tool (Epson: TM Utility app or
the printer's web page) or the router's WPS button.

- **Discovery** (`GET /discover`, or `printer-code discover`) checks every
  address on this machine's networks (each narrowed to its own /24, i.e. 254
  addresses, ~2 s) for an open raw print port 9100. It then asks each printer
  for its model over SNMP (`public` community) to choose ESC/POS, ZPL or TSPL.
  Printers on another subnet, or on Wi‑Fi with client isolation, won't appear;
  add those by IP instead.
- **Connecting** (`POST /printers/add`) only accepts ports 9100–9109 and only
  saves a printer that answers, so the agent can't be used to send bytes to
  other services on the network. Saved printers live in the `--state` file
  (`saved-printers.json`): `/var/lib/printer-agent/` on Linux,
  `~/Library/Application Support/printer-agent/` on macOS. They survive restarts.
- **IP changes are handled.** On connect the agent records the printer's MAC
  address (from the ARP table) and names the printer by it. Before every
  print it checks the saved IP still answers *and* belongs to that MAC; if not
  (new DHCP lease, or the old IP now belongs to another device) it rescans,
  follows the MAC to the new IP, saves it and prints there. A printer that
  can't be found gives an error; nothing is printed elsewhere. MACs are only
  visible on the local network, so a printer added by IP across a router keeps
  a fixed address. A DHCP reservation is still the most predictable setup. Scanning reveals which devices are on the network, so set
  `allowOrigins` to your app's origin on shared machines.
- The kitchen admin's Printer settings (USB / Ethernet / Wi‑Fi) uses these calls.

Jobs are queued, so two tabs printing at the same moment never mix their bytes.
To allow only your app, add `"agent": { "allowOrigins": ["https://kitchen.example.com"] }`
to `printers.json`. The default allows any origin, which is fine for a kiosk
that only opens your app. Requests with a non-localhost `Host` header are always
refused to block DNS rebinding. The agent also answers Chrome's
Private-Network-Access preflight, so an **https** kitchen app can call it.

**macOS:** run `./release/install-macos.sh` **without sudo**. Node 18+ must
already be installed (`brew install node`). It installs a LaunchAgent that
starts at login and restarts if it crashes. Config and log are in
`~/Library/Application Support/printer-agent/`. Remove it with
`./release/install-macos.sh --uninstall`. macOS has no `/dev/usb/lp*` and no
longer allows raw printer queues, so the agent handles USB printers itself.
Whenever a thermal USB printer is plugged in (at install time or later), it adds
it to CUPS with the generic driver, and every job is sent with `lp -o raw`,
which skips that driver. This needs an admin Mac user; for other users, add
the printer once in System Settings → Printers & Scanners. Network printers can
go straight into `printers.json` as `tcp`.

**Windows:** run the agent at login with
`schtasks /create /sc onlogon /tr "node C:\printer-agent\printer-agent.js agent --config C:\printer-agent\printers.json" /tn printer-agent`.
Add the printer to `printers.json` as a shared `spooler` printer, because
Windows has no driverless auto-detect.

### 2. WebUSB fallback (nothing installed)

Used when no agent answers. It works in Chrome, Edge and Chromium only.
- The first print shows Chrome's USB printer picker, which needs a click. To
  skip it on a managed kiosk, set the Chrome policy
  `WebUsbAllowDevicesForUrls` to your printer's vendor/product ID and your app's URL.
- **macOS and ChromeOS:** works as is.
- **Linux (Pi/Jetson):** the kernel `usblp` driver holds the printer, so run
  `sudo ./webusb-linux.sh` once. This removes `/dev/usb/lp*`, which turns off
  the agent's USB path, so choose **one** path per kiosk.
- **Windows:** the printer needs the WinUSB driver (e.g. via Zadig).

### Use it in the kiosk page

```html
<script src="/printer-code.browser.js"></script>   <!-- copy from release/ into the app's public/ -->
<script>
  button.onclick = async () => {
    const png = await fetch('/api/inventory/labels/C123.png?size=78x50').then(r => r.blob());
    const via = await PrinterCode.printLabels([png], { copies: 1 });   // 'agent' | 'webusb'
  };
  // PrinterCode.agentStatus() → status or null;  PrinterCode.pairUsbPrinter() → USB picker
</script>
```

`printLabels` accepts PNG `Blob`s or `<canvas>` elements. Options:
- `printer`: agent printer name.
- `copies`
- `agentUrl`
- `driver` (WebUSB only): `'escpos' | 'zpl' | 'tspl'` or your own `{ encode }` object.

## Install on a device (CLI / library use)

```bash
# Node 18+ (Jetson/Pi: the distro apt package is often too old, so use nvm or NodeSource)
cd printer_code
npm install
npm run build
cp printers.example.json printers.json   # then edit for this site
```

Each site or device keeps its own `printers.json`, and the code is the same everywhere.

## Command line

```bash
node dist/cli.js list                                   # configured + auto-detected printers
node dist/cli.js detect                                 # only auto-detected (USB / CUPS)
node dist/cli.js discover                               # scan the network (Ethernet / Wi-Fi) for printers
node dist/cli.js test  --printer kitchen-epson-lan      # print a test pattern
node dist/cli.js print label1.png label2.png --printer kitchen-epson-lan --copies 2
```

The config file is found in this order: `--config <file>`, then `$PRINTER_CONFIG`, then `./printers.json` (optional: without it, detected printers are used).
If you leave out `--printer`, the first printer in the file is used. Run `npm link`
once to get a global `printer-code` command.

**From other languages:** the CLI is the shared interface. For example, from
Python on a Jetson: `subprocess.run(["printer-code", "print", "label.png", "--printer", "kitchen"], check=True)`.

## Library (Node / TypeScript)

```ts
import { createPrinter } from '@antzsoft/printer-code'; // npm install ../printer_code

const printer = createPrinter({
  driver: { type: 'escpos' },
  transport: { type: 'tcp', host: '192.168.1.50' },
  widthDots: 624,
});
await printer.print([png1, png2]);      // PNG buffers or MonoRaster objects
```

`print()` sends **one job per label** and waits for each to be accepted before
sending the next. When many raster labels are batched into one job they overflow
small printer buffers (Epson TM ≈128 KB ≈ 3 labels), and the printer silently
cuts the print off mid-label. All labels are decoded and checked before
anything is sent, so one bad image does not leave a batch half-printed.

## Adding a printer (driver) or a connection type (transport)

A driver is `{ encode(raster) => Buffer }`. A transport is `{ send(buffer) => Promise<void> }`.
`raster` is `{ width, height, data }`: 1 bit per dot, 8 dots per byte, MSB first,
set bit = black. `width` is always a multiple of 8.

**In code:**

```ts
import { registerDriver, registerTransport } from '@antzsoft/printer-code';

registerDriver('my-brand', (opts) => ({ encode: (r) => buildMyBrandBytes(r, opts) }));
registerTransport('my-link', (opts) => ({ send: async (bytes) => myLink.write(bytes) }));
```

**Without touching the library (per site):** write a plugin file and list it in `printers.json`:

```json
{
  "plugins": ["./examples/escpos-legacy.plugin.js"],
  "printers": { "old": { "driver": { "type": "escpos-legacy" }, "transport": { "type": "tcp", "host": "10.0.0.9" } } }
}
```

[`examples/escpos-legacy.plugin.js`](examples/escpos-legacy.plugin.js) is a
complete, working plugin. It adds a driver for old ESC/POS printers that lack
the `GS v 0` raster command. Copy it as a template.

Ideas that fit as plugins: Star Line Mode, Brother raster, EPL2, Godex EZPL;
direct USB via the `usb` npm package, `serialport` with baud configuration,
Bluetooth LE.

## Platform notes

- **Label size:** render the PNG at the printer's dot size (203 dpi ≈ 8 dots/mm,
  so 78 × 50 mm = 624 × 400 dots, the same as the kitchen backend). Images
  are never scaled. Set `widthDots` so oversized images are rejected instead of clipped.
- **Linux USB** (`/dev/usb/lp0`): add the user to the `lp` group (`sudo usermod -aG lp $USER`).
- **Linux serial:** set the speed before printing, e.g. `stty -F /dev/ttyUSB0 115200 raw`.
- **CUPS:** add the printer as a *raw* queue, e.g. `lpadmin -p Zebra -E -v socket://IP:9100 -m raw`
  (on newer CUPS, prefer `tcp`).
- **Windows `spooler`:** share the printer (Printer properties → Sharing) and set
  `queue` to the share name.
- **`epos-http` over https:** the printer's self-signed certificate is rejected by
  Node. Use http on the LAN, or install the printer's certificate on the device.
- **Network:** the device running this must be able to reach the printer. A cloud
  server cannot reach a `192.168.x.x` printer. Run this on a box inside the site's LAN.

## Develop

```bash
npm test         # node:test via tsx (Node ≥ 21 for the glob)
npm run bundle   # → release/ (agent single file, browser script, install scripts)
npm run build    # → dist/
```
