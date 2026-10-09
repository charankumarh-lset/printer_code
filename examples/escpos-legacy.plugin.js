// Example plugin: adds an "escpos-legacy" driver for old/cheap ESC/POS
// printers that don't support the GS v 0 raster command. It prints the image
// as 24-dot strips with ESC * (bit-image mode 33, column-major).
//
// Enable it in printers.json:
//   "plugins": ["./examples/escpos-legacy.plugin.js"],
//   "printers": { "old": { "driver": { "type": "escpos-legacy" }, "transport": { ... } } }
//
// A plugin is any CommonJS module exporting `function (api)`; api has
// registerDriver(type, factory) and registerTransport(type, factory).
// A driver is just { encode(raster) => Buffer }; a transport is
// { send(buffer) => Promise<void> }. See src/types.ts for MonoRaster.

module.exports = function register({ registerDriver }) {
  registerDriver('escpos-legacy', (opts) => ({
    encode({ width, height, data }) {
      const bytesPerRow = width / 8;
      const black = (x, y) => y < height && (data[y * bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) !== 0;

      const parts = [Buffer.from([0x1b, 0x40, 0x1b, 0x33, 24])]; // reset; line spacing = 24 dots
      for (let y0 = 0; y0 < height; y0 += 24) {
        const strip = Buffer.alloc(width * 3);
        for (let x = 0; x < width; x++) {
          for (let bit = 0; bit < 24; bit++) {
            if (black(x, y0 + bit)) strip[x * 3 + (bit >> 3)] |= 0x80 >> (bit & 7);
          }
        }
        parts.push(Buffer.from([0x1b, 0x2a, 33, width & 0xff, (width >> 8) & 0xff]), strip, Buffer.from([0x0a]));
      }
      parts.push(Buffer.from([0x1b, 0x32, 0x1b, 0x64, opts.feedLines ?? 3, 0x1d, 0x56, 0x00])); // default spacing, feed, cut
      return Buffer.concat(parts);
    },
  }));
};
