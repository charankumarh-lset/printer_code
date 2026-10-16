/**
 * Kitchen renders every label at 8 dots/mm (203 dpi). A printer with a finer
 * print head gets the image scaled up so the label keeps its physical size.
 */
export const LABEL_DOTS_PER_MM = 8;

/** Print-head resolution by brand, for printers whose config sets no `dpi`. */
const BRAND_DPI: [RegExp, number][] = [
  [/seznik/i, 300],
  [/epson/i, 203],
];

export function defaultDpi(hint: string): number {
  return BRAND_DPI.find(([brand]) => brand.test(hint))?.[1] ?? 203;
}

/** How much to enlarge an 8 dots/mm label for this print head; 1 when the sizes already match. */
export function labelScale(dpi: number): number {
  const scale = dpi / 25.4 / LABEL_DOTS_PER_MM;
  return Math.abs(scale - 1) < 0.01 ? 1 : scale;
}
