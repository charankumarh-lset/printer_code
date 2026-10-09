import type { MonoRaster } from './types';

/**
 * Threshold RGBA pixels (PNG decode, or canvas ImageData in the browser) to a
 * 1-bit raster. The right edge is padded with white up to a multiple of 8 dots.
 * No Node/DOM APIs here, so the browser bundle shares it with the agent.
 */
export function rgbaToMono(rgba: ArrayLike<number>, width: number, height: number, threshold = 128): MonoRaster {
  const paddedWidth = Math.ceil(width / 8) * 8;
  const bytesPerRow = paddedWidth / 8;
  const data = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      // Composite onto white so transparent pixels don't print as black.
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width: paddedWidth, height, data };
}

export function assertRaster(r: MonoRaster): void {
  if (r.width <= 0 || r.width % 8 !== 0) throw new Error('raster width must be a positive multiple of 8');
  if (r.data.length !== (r.width / 8) * r.height) {
    throw new Error(`raster length ${r.data.length} != ${r.width / 8} * ${r.height}`);
  }
}

/** Border, diagonal and a checker strip — for checking a new printer setup end to end. */
export function testPattern(width: number, height: number): MonoRaster {
  const w = Math.ceil(width / 8) * 8;
  const bytesPerRow = w / 8;
  const data = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      const diagonal = Math.abs(Math.round((x * height) / width) - y) < 2;
      const checker = y > height * 0.75 && ((x >> 4) + (y >> 4)) % 2 === 0;
      if (border || diagonal || checker) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width: w, height, data };
}
