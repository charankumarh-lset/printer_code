import { PNG } from 'pngjs';

import { rgbaToMono } from './mono';
import type { MonoRaster } from './types';

export { assertRaster, rgbaToMono, testPattern } from './mono';

/**
 * Decode a PNG and threshold it to a 1-bit raster. Pure JS (no native
 * modules), so it runs unchanged on x64/arm64/armv7 — Jetson, Pi, Win, Mac.
 */
export function pngToMono(png: Buffer, threshold = 128, scale = 1): MonoRaster {
  const img = PNG.sync.read(png);
  if (scale === 1) return rgbaToMono(img.data, img.width, img.height, threshold);
  const scaled = scaleRgba(img.data, img.width, img.height, scale);
  return rgbaToMono(scaled.data, scaled.width, scaled.height, threshold);
}

/** Bilinear resize before thresholding, so enlarged text stays smooth instead of blocky. */
export function scaleRgba(rgba: ArrayLike<number>, width: number, height: number, scale: number) {
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const p = (yy: number, xx: number) => rgba[(yy * width + xx) * 4 + c];
        const top = p(y0, x0) * (1 - fx) + p(y0, x1) * fx;
        const bottom = p(y1, x0) * (1 - fx) + p(y1, x1) * fx;
        data[(y * w + x) * 4 + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return { data, width: w, height: h };
}
