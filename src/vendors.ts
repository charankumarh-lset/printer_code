/** Built-in drivers that can be picked automatically for a USB printer. */
export type AutoDriver = 'escpos' | 'zpl' | 'tspl';

/** USB vendor IDs of thermal printer makers → their default language. */
const BY_VENDOR: Record<number, AutoDriver> = {
  0x04b8: 'escpos', // Epson
  0x0416: 'escpos', // Winbond — used by Xprinter and many generic printers
  0x0483: 'escpos', // STMicro — generic
  0x0dd4: 'escpos', // Custom
  0x0fe6: 'escpos', // ICS — generic
  0x1504: 'escpos', // Bixolon
  0x154f: 'escpos', // SNBC
  0x1fc9: 'escpos', // NXP — generic
  0x20d1: 'escpos', // Rongta
  0x28e9: 'escpos', // GigaDevice — generic
  0x0a5f: 'zpl', // Zebra
  0x1203: 'tspl', // TSC
};

/** Names/models that look like thermal receipt or label printers (not office printers). */
const THERMAL_NAME = /\bTM-|\bZ[DTQ]\d|\bG[KX]\d|zebra|\bTSC\b|\bT[EAT]\d{3}|\bXP-|\bPOS|thermal|receipt|label/i;

export interface PrinterHints {
  vendorId?: number;
  /** IEEE 1284 command set, e.g. "ESC/POS" or "ZPL" (CMD: field of the device ID). */
  commandSet?: string;
  /** Manufacturer, model or queue name. */
  name?: string;
}

/** Best guess at the printer language. Falls back to ESC/POS, the most common. */
export function guessDriver({ vendorId, commandSet = '', name = '' }: PrinterHints): AutoDriver {
  const cmd = commandSet.toUpperCase();
  if (cmd.includes('ZPL')) return 'zpl';
  if (cmd.includes('TSPL')) return 'tspl';
  if (/ESC\/?POS/.test(cmd)) return 'escpos';
  if (vendorId !== undefined && BY_VENDOR[vendorId]) return BY_VENDOR[vendorId];
  if (/zebra|\bZ[DTQ]\d|\bG[KX]\d/i.test(name)) return 'zpl';
  if (/\bTSC\b|\bT[EAT]\d{3}/i.test(name)) return 'tspl';
  return 'escpos';
}

export function isKnownThermal({ vendorId, commandSet = '', name = '' }: PrinterHints): boolean {
  return (
    (vendorId !== undefined && vendorId in BY_VENDOR) ||
    /ESC\/?POS|ZPL|TSPL/i.test(commandSet) ||
    THERMAL_NAME.test(name)
  );
}

/** Parse an IEEE 1284 device ID ("MFG:EPSON;CMD:ESC/POS;MDL:TM-L100;") into its fields. */
export function parseDeviceId(id: string): { manufacturer?: string; model?: string; commandSet?: string } {
  const fields = new Map<string, string>();
  for (const part of id.split(';')) {
    const at = part.indexOf(':');
    if (at > 0) fields.set(part.slice(0, at).trim().toUpperCase(), part.slice(at + 1).trim());
  }
  return {
    manufacturer: fields.get('MFG') ?? fields.get('MANUFACTURER'),
    model: fields.get('MDL') ?? fields.get('MODEL'),
    commandSet: fields.get('CMD') ?? fields.get('COMMAND SET'),
  };
}
