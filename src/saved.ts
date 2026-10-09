import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { NamedPrinter } from './types';

/**
 * Printers added at runtime (network printers connected from the app),
 * kept in their own JSON file so the admin-managed printers.json stays read-only.
 */
export class SavedPrinters {
  constructor(readonly file: string) {}

  list(): Record<string, NamedPrinter> {
    try {
      return (JSON.parse(readFileSync(this.file, 'utf8')) as { printers?: Record<string, NamedPrinter> }).printers ?? {};
    } catch {
      return {}; // not created yet
    }
  }

  set(name: string, printer: NamedPrinter): void {
    this.write({ ...this.list(), [name]: printer });
  }

  remove(name: string): boolean {
    const printers = this.list();
    if (!(name in printers)) return false;
    delete printers[name];
    this.write(printers);
    return true;
  }

  private write(printers: Record<string, NamedPrinter>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    // Write-then-rename so a crash mid-write never leaves a truncated file.
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ printers }, null, 2));
    renameSync(tmp, this.file);
  }
}
