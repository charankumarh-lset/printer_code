import { create } from 'qrcode';

/** Not a package id, so scanning a test label in the kiosk can never match real work. */
const TEST_QR = 'ANTZ-TEST-LABEL';

function qrModules(): { size: number; bits: string } {
  const { modules } = create(TEST_QR, { errorCorrectionLevel: 'M' });
  return { size: modules.size, bits: Array.from(modules.data, (b) => (b ? '1' : '0')).join('') };
}

/**
 * The agent's own page (GET /). Its test label is a sample packing-kiosk label
 * (same layout as the backend's packing-label-layout.ts), drawn on a canvas at
 * 8 dots/mm and sent through POST /print — the same path real kiosk labels take.
 */
export function setupPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Printer agent</title><style>
body{font:16px system-ui,sans-serif;margin:24px;max-width:720px}button{font-size:16px;padding:8px 14px;margin:4px 0}
li{margin:8px 0}code{background:#eee;padding:1px 4px}#msg{margin-top:12px;font-weight:600}
fieldset{border:1px solid #ccc;border-radius:8px;padding:12px 16px;margin:16px 0}
label{display:inline-block;margin:4px 16px 4px 0}input{width:5em;font-size:16px;padding:4px}
#preview{border:1px solid #bbb;max-width:100%}
.hint{color:#666;font-size:14px}</style></head><body>
<h1>Printer agent is running</h1>
<fieldset><legend>Test label settings</legend>
<label>Width (mm) <input id="w" type="number" min="30" max="150" step="1"></label>
<label>Height (mm) <input id="h" type="number" min="30" max="200" step="1"></label>
<label>Copies <input id="copies" type="number" min="1" max="10" step="1"></label>
<p class="hint">Use your sticker size (e.g. 50 × 50 mm). Width 30–150 mm, height 30–200 mm. Saved on this computer.</p>
<canvas id="preview"></canvas>
</fieldset>
<p>Connected printers (plug one in and reload):</p><ul id="list"><li>Loading…</li></ul><div id="msg"></div>
<script>
const QR = ${JSON.stringify(qrModules())};
const msg = document.getElementById('msg');
const inputs = { w: document.getElementById('w'), h: document.getElementById('h'), copies: document.getElementById('copies') };
const defaults = { w: 50, h: 50, copies: 1 };
let saved = {};
try { saved = JSON.parse(localStorage.getItem('agent-test-label') || '{}'); } catch (e) {}
for (const k in inputs) inputs[k].value = saved[k] || defaults[k];

function settings() {
  const w = Number(inputs.w.value), h = Number(inputs.h.value), copies = Number(inputs.copies.value);
  if (!Number.isInteger(w) || w < 30 || w > 150) return { error: 'Width must be a whole number from 30 to 150 mm' };
  if (!Number.isInteger(h) || h < 30 || h > 200) return { error: 'Height must be a whole number from 30 to 200 mm' };
  if (!Number.isInteger(copies) || copies < 1 || copies > 10) return { error: 'Copies must be 1 to 10' };
  return { w: w, h: h, copies: copies };
}

// Sample content in the shape of a real packing label.
function sample() {
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  return {
    area: '73G3A', identity: '73 Acres / 73 Group 3',
    date: pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear(), time: '7:00 AM', id: 'TESTLABL',
    items: [
      { name: 'Groundnuts', detail: 'With shell · Whole', quantity: '910 gm' },
      { name: 'Sunflower seeds', detail: 'With shell · Whole', quantity: '910 gm' },
      { name: 'Vantara Trio Munch', detail: 'Raw · Whole', quantity: '1.82 kg' },
    ],
  };
}

// Mirrors antz_kitchen_backend/src/packing/packing-label-layout.ts (8 dots per mm).
// Lays out on a width × height virtual label; returns whether every item fits.
function layout(ctx, width, height, qrSize) {
  const c = sample(), margin = 12, gap = 10, innerWidth = width - margin * 2;
  const qr = { x: width - margin - qrSize, y: margin };
  const leftWidth = innerWidth - qrSize - gap;
  const textWidth = (t, size, bold) => { ctx.font = font(size, bold); return ctx.measureText(t).width; };
  const wrap = (t, max, size, bold) => {
    const out = []; let line = '';
    for (const word of t.trim().split(/\\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (textWidth(next, size, bold) <= max) { line = next; continue; }
      if (line) { out.push(line); line = ''; }
      for (const ch of word) {
        if (line && textWidth(line + ch, size, bold) > max) { out.push(line); line = ''; }
        line += ch;
      }
    }
    if (line) out.push(line);
    return out;
  };
  const texts = [], rules = [];
  const headerLimit = Math.min(height - margin - 64, Math.max(margin + qrSize + 22, height * 0.52));
  const makeHeader = size => {
    const labels = []; let y = margin;
    for (const [value, s, bold] of [[c.area, size + 6, true], [c.identity, size, false], [c.date, size, false], [c.time, size + 2, true]])
      for (const line of wrap(value, leftWidth, s, bold)) { labels.push({ t: line, x: margin, y: y, s: s, bold: bold }); y += s + 4; }
    labels.push({ t: c.id, x: qr.x, y: margin + qrSize + 2, s: 14, bold: false });
    return { labels: labels, bottom: Math.max(y, margin + qrSize + 20) };
  };
  let header = makeHeader(18);
  for (const s of [17, 16, 15, 14]) { if (header.bottom <= headerLimit) break; header = makeHeader(s); }
  texts.push(...header.labels);
  const bodyTop = header.bottom + 12, bodyBottom = height - margin;
  rules.push({ x: margin, y: bodyTop - 6, width: innerWidth });

  const blocksFor = size => c.items.map(item => {
    const lines = [], detail = Math.max(16, size - 2);
    const amountWidth = Math.min(innerWidth * 0.43, Math.max(innerWidth * 0.28, textWidth(item.quantity, size, true)));
    const names = wrap(item.name, innerWidth - amountWidth - gap, size, true), amounts = wrap(item.quantity, amountWidth, size, true);
    for (let n = 0; n < Math.max(names.length, amounts.length); n++) {
      const row = [];
      if (names[n]) row.push({ t: names[n], x: margin, s: size, bold: true });
      if (amounts[n]) row.push({ t: amounts[n], x: width - margin - textWidth(amounts[n], size, true), s: size, bold: true });
      lines.push({ texts: row, height: size + 4 });
    }
    for (const line of wrap(item.detail, innerWidth, detail, false)) lines.push({ texts: [{ t: line, x: margin, s: detail, bold: false }], height: detail + 4 });
    return lines;
  });
  const blockHeight = b => b.reduce((s, l) => s + l.height, 0);
  const total = blocks => blocks.reduce((sum, b) => sum + blockHeight(b) + 8, 0);
  let blocks = blocksFor(18);
  for (const s of [24, 22, 20, 18]) { const b = blocksFor(s); if (total(b) <= bodyBottom - bodyTop) { blocks = b; break; } }
  // A test label is one sticker: items that don't fit are left off instead of paginating.
  let y = bodyTop, fits = true;
  for (const block of blocks) {
    if (y + blockHeight(block) > bodyBottom) { fits = false; break; }
    for (const line of block) { for (const t of line.texts) texts.push(Object.assign({ y: y }, t)); y += line.height; }
    if (y + 8 <= bodyBottom) { rules.push({ x: margin, y: y + 3, width: innerWidth }); y += 8; }
  }
  return { texts: texts, rules: rules, qr: qr, fits: fits };
}

function font(size, bold) { return (bold ? 'bold ' : '') + size + 'px sans-serif'; }

function draw(canvas, widthMm, heightMm) {
  const width = widthMm * 8, height = heightMm * 8;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  // Whole printer dots and a four-module quiet zone keep the QR crisp.
  const dot = widthMm >= 40 ? 3 : 2, quiet = 4, qrSize = (QR.size + quiet * 2) * dot;
  // As the kiosk label does: lay out on a smaller virtual label and draw it
  // enlarged (≤1.6×) so the type fills the sticker, if everything still fits.
  const maxScale = Math.min(1.6, Math.min(widthMm, heightMm) / 30);
  let scale = 1, page = layout(ctx, width, height, qrSize);
  for (let s = Math.floor(maxScale * 20) / 20; s > 1; s = Math.round((s - 0.05) * 100) / 100) {
    const candidate = layout(ctx, width / s, height / s, qrSize / s);
    if (candidate.fits) { scale = s; page = candidate; break; }
  }
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
  for (const t of page.texts) { ctx.font = font(t.s * scale, t.bold); ctx.fillText(t.t, t.x * scale, t.y * scale); }
  for (const r of page.rules) ctx.fillRect(Math.round(r.x * scale), Math.round(r.y * scale), Math.round(r.width * scale), Math.max(1, Math.round(scale)));
  const qrX = Math.round(page.qr.x * scale), qrY = Math.round(page.qr.y * scale);
  for (let row = 0; row < QR.size; row++) for (let col = 0; col < QR.size; col++)
    if (QR.bits[row * QR.size + col] === '1') ctx.fillRect(qrX + (col + quiet) * dot, qrY + (row + quiet) * dot, dot, dot);
}

const preview = document.getElementById('preview');
function refresh() {
  const s = settings();
  msg.textContent = s.error || '';
  if (s.error) return;
  try { localStorage.setItem('agent-test-label', JSON.stringify(s)); } catch (e) {}
  draw(preview, s.w, s.h);
}
for (const k in inputs) inputs[k].oninput = refresh;
refresh();

async function printTest(name) {
  const s = settings();
  if (s.error) { msg.textContent = s.error; return; }
  msg.textContent = 'Printing…';
  const canvas = document.createElement('canvas');
  draw(canvas, s.w, s.h);
  const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const r = await fetch('/print?printer=' + encodeURIComponent(name) + '&copies=' + s.copies, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })
    .then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
  msg.textContent = r.ok ? 'Sent ' + s.copies + ' test label' + (s.copies > 1 ? 's' : '') + ' (' + s.w + ' × ' + s.h + ' mm) to ' + name : 'Failed: ' + r.error;
}

fetch('/status').then(r => r.json()).then(s => {
  const list = document.getElementById('list');
  list.innerHTML = s.printers.length ? '' : '<li>No printer found. Check the USB cable, or add one to printers.json.</li>';
  for (const p of s.printers) {
    const li = document.createElement('li');
    li.innerHTML = '<code></code> <span></span><br><button class="test">Print test label</button>';
    li.querySelector('code').textContent = p.name;
    li.querySelector('span').textContent = p.description || p.driver + ' via ' + p.transport;
    li.querySelector('.test').onclick = () => printTest(p.name);
    if (p.driver === 'tspl') {
      const shift = document.createElement('div');
      shift.innerHTML = '<label>Shift right (mm) <input type="number" min="0" max="10" step="0.5"></label><button>Save shift</button>' +
        '<div class="hint">Left edge of the label cut off? Increase this (try 2), save, and print a test label again.</div>' +
        '<button class="feed">Feed blank label</button> <button class="calibrate">Calibrate paper</button>' +
        '<div class="hint">Feed pushes out one blank label (after a jam or folded label). Calibrate makes the printer find the label gaps again after loading a new roll.</div>';
      for (const [cls, path, done] of [['.feed', '/feed', 'Fed one blank label'], ['.calibrate', '/calibrate', 'Calibrating…']]) {
        shift.querySelector(cls).onclick = async () => {
          const r = await fetch(path + '?printer=' + encodeURIComponent(p.name), { method: 'POST' }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
          msg.textContent = r.ok ? done + ' on ' + p.name : 'Failed: ' + r.error;
        };
      }
      const input = shift.querySelector('input');
      input.value = p.shiftMm || 0;
      shift.querySelector('label + button').onclick = async () => {
        const r = await fetch('/printers/shift', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: p.name, shiftMm: Number(input.value) }) })
          .then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
        msg.textContent = r.ok ? 'Saved: ' + p.name + ' labels move ' + r.printer.shiftMm + ' mm right' : 'Failed: ' + r.error;
      };
      li.appendChild(shift);
    }
    list.appendChild(li);
  }
});
</script></body></html>`;
}
