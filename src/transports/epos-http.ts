import type { Transport } from '../types';

export interface EposHttpOptions {
  host: string;
  /** Default 80 (http) / 443 (https). */
  port?: number;
  ssl?: boolean;
  /** Device ID configured on the printer (default local_printer). */
  devid?: string;
  timeoutMs?: number;
}

/** POST an ePOS-Print XML document (from the `epos` driver) to the printer's built-in web service. */
export class EposHttpTransport implements Transport {
  constructor(private readonly opts: EposHttpOptions) {
    if (!opts.host) throw new Error('epos-http transport needs "host"');
  }

  async send(payload: Buffer): Promise<void> {
    const { host, port, ssl = false, devid = 'local_printer', timeoutMs = 15000 } = this.opts;
    const origin = `${ssl ? 'https' : 'http'}://${host}${port ? `:${port}` : ''}`;
    const url = `${origin}/cgi-bin/epos/service.cgi?devid=${encodeURIComponent(devid)}&timeout=${timeoutMs}`;
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
      payload.toString('utf8') +
      '</s:Body></s:Envelope>';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT',
        SOAPAction: '""',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs + 5000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ePOS HTTP ${res.status} from ${origin}`);
    if (!/success="true"/.test(text)) {
      const code = /code="([^"]*)"/.exec(text)?.[1] || 'unknown';
      throw new Error(`ePOS print failed at ${origin} (${code})`);
    }
  }
}
