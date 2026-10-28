// Pure color helpers. Deliberately dependency-free so the dwm-facing wire
// format can be tested without loading the palette library.

/** Packed ARGB (as produced by material-color-utilities) -> `#rrggbb`. */
export function argbToHex(argb) {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** `#rrggbb` -> {r,g,b} in 0..255. Throws on anything dwm would reject. */
export function hexToRgb(hex) {
  if (!isHex6(hex)) throw new Error(`not a #rrggbb color: ${JSON.stringify(hex)}`);
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * Exactly dwm's blendhex(), integer for integer:
 *   out = (a * alpha + b * (255 - alpha)) / 255      // C truncating division
 * i.e. `a` composited at `alpha` over the opaque `b`. dwm uses this to fake the
 * look of a translucent chip drawn on top of the bar background, so our
 * contrast checks have to see the same pixel dwm will see.
 *
 * @param {number} alpha 0..255, dwm's own scale
 */
export function blendHex(a, b, alpha) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) {
    throw new Error(`alpha must be an integer 0..255, got ${alpha}`);
  }
  const mix = (x, y) => Math.floor((x * alpha + y * (255 - alpha)) / 255);
  const to = (v) => v.toString(16).padStart(2, '0');
  return `#${to(mix(ca.r, cb.r))}${to(mix(ca.g, cb.g))}${to(mix(ca.b, cb.b))}`;
}

/** `#rrggbb` from three 0..255 channels. */
export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG 2.x relative luminance of three 0..255 sRGB channels. */
export function luminanceOfRgb(r, g, b) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x relative luminance of an sRGB `#rrggbb` color. */
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return luminanceOfRgb(r, g, b);
}

/** WCAG 2.x contrast ratio, 1..21. Order-independent. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** True for exactly the 7-character `#rrggbb` form dwm's parser accepts. */
export function isHex6(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}
