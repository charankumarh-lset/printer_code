import { PNG } from 'pngjs';

import { rgbaToMono } from './mono';
import type { MonoRaster } from './types';

export { assertRaster, rgbaToMono, testPattern } from './mono';

/**
 * Decode a PNG and threshold it to a 1-bit raster. Pure JS (no native
 * modules), so it runs unchanged on x64/arm64/armv7 — Jetson, Pi, Win, Mac.
 */
export function pngToMono(png: Buffer, threshold = 128): MonoRaster {
  const img = PNG.sync.read(png);
  return rgbaToMono(img.data, img.width, img.height, threshold);
}
