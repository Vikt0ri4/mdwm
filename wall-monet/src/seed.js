// Step one of the Material pipeline: pixels -> one representative seed color.
//
// This is Google's own Celebi quantizer + Score ranking (what
// sourceColorFromImage() runs under the hood): no chroma floor, no clamping, no
// hand-tuned heuristics. A greyscale wallpaper therefore takes whatever hue HCT
// reads for neutrals rather than being forced grey -- see README.
//
// One deliberate deviation. material-color-utilities' QuantizerWsmeans calls
// Math.random() twice: once to place extra k-means centroids and once to assign
// every pixel to an initial cluster. The JS port is therefore NOT reproducible:
// five runs over one wallpaper produced five different seeds
// (#73b8c7 / #8cd9e8 / #72b8c6 / #9eecf9 / #8cd9e8), which makes the bar drift
// every time you press Super+Shift+W. We keep the algorithm exactly as it is and
// only pin the random stream, so the same wallpaper always yields the same
// palette.
//
// The alternative would have been to drop Celebi for QuantizerWu + Score (also
// deterministic), but that silently changes *which* colour is chosen rather than
// just making the existing choice reproducible.
import { Hct, hexFromArgb, sourceColorFromImageBytes } from '@material/material-color-utilities';
import { luminanceOfRgb, rgbToHex } from './color.js';

/** Deterministic 31-bit LCG; any fixed constants would do, these are the classic ones. */
function makeFixedRandom(seed = 0x2f6e2b1) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state & 0x7fffffff) / 0x7fffffff;
  };
}

/** Run `fn` with Math.random replaced by a deterministic stream. */
function withFixedRandom(fn) {
  const saved = Math.random;
  Math.random = makeFixedRandom();
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

export function seedFromRgba(rgba) {
  if (!rgba || rgba.length < 4) throw new Error('need at least one RGBA pixel to extract a seed color');
  const argb = withFixedRandom(() => sourceColorFromImageBytes(rgba));
  const hct = Hct.fromInt(argb);
  return { argb, hex: hexFromArgb(argb), hue: hct.hue, chroma: hct.chroma, tone: hct.tone };
}

/**
 * A bounded set of wallpaper colours to stand in for "whatever ends up behind
 * the translucent bar" when checking contrast.
 *
 * `band` restricts the sample to the top fraction of the image. That matters once
 * the bar is genuinely translucent: the bar is only ~40px tall at the top of the
 * screen, so the only wallpaper pixels that can ever sit behind it are in the top
 * band. Sampling the whole image instead makes the check assume a dark region and
 * a bright region can both be behind the bar at once, which no single text colour
 * can satisfy.
 *
 * A text colour's worst case is attained against the background whose luminance
 * is closest to its own, so the extremes must never be missed: the darkest and
 * lightest pixels are always included, and the rest is an even stride over the
 * buffer. Sampling more would not change the answer, it would only cost time.
 *
 * @param {Uint8ClampedArray} rgba
 * @returns {string[]} `#rrggbb` samples, darkest first is NOT guaranteed
 */
export function backdropSamples(rgba, max = 192, { width = 0, height = 0, band = 1 } = {}) {
  if (!rgba || rgba.length < 4) return [];
  const total = Math.floor(rgba.length / 4);
  // Restrict to the top `band` fraction when the geometry is known.
  const rows = width > 0 && height > 0 ? height : 0;
  let count = total;
  let first = 0;
  if (rows > 0 && band > 0 && band < 1) {
    count = Math.max(1, Math.ceil(rows * band)) * width;
    if (count > total) count = total;
  }
  const at = (i) => {
    const k = first + i;
    return rgbToHex(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]);
  };
  if (count <= max) {
    const all = [];
    for (let i = 0; i < count; i++) all.push(at(i));
    return all;
  }
  let darkest = 0;
  let lightest = 0;
  let darkestLum = Infinity;
  let lightestLum = -Infinity;
  for (let i = 0; i < count; i++) {
    const k = first + i;
    const lum = luminanceOfRgb(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]);
    if (lum < darkestLum) {
      darkestLum = lum;
      darkest = i;
    }
    if (lum > lightestLum) {
      lightestLum = lum;
      lightest = i;
    }
  }
  const picked = new Set([darkest, lightest]);
  const stride = Math.max(1, Math.floor(count / (max - 2)));
  for (let i = 0; i < count && picked.size < max; i += stride) picked.add(i);
  return [...picked].map(at);
}

/**
 * The colours that actually sit behind the bar, *as the compositor presents them*.
 *
 * The bar is a thin band at the top of the screen, so only that strip of the
 * wallpaper can ever be behind it -- and picom blurs that strip before dwm's text
 * is drawn over it. Measuring the strip pixel-by-pixel is therefore both wrong
 * (it assumes the whole image can be behind the bar) and pessimistic (it assumes
 * sharp detail, which the blur has already removed).
 *
 * This averages the strip into `cells` buckets, which is what a wide Kawase blur
 * converges to. Caveat: it is an approximation -- with picom NOT running, the real
 * backdrop is the sharp strip and the true contrast is lower than reported.
 *
 * @param {Uint8ClampedArray} rgba decoded pixels
 * @param {{width:number, height:number, band?:number, cells?:number}} geometry
 * @returns {string[]} `#rrggbb` cell averages, left to right
 */
export function blurredBarBackdrops(rgba, { width, height, band = 0.05, cells = 8 } = {}) {
  if (!rgba || rgba.length < 4 || !width || !height) return [];
  const rows = Math.max(1, Math.min(height, Math.ceil(height * band)));
  const n = Math.max(1, Math.min(cells, width));
  const out = [];
  for (let c = 0; c < n; c++) {
    const x0 = Math.floor((c * width) / n);
    const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * width) / n));
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        r += rgba[i];
        g += rgba[i + 1];
        b += rgba[i + 2];
        count++;
      }
    }
    out.push(rgbToHex(Math.round(r / count), Math.round(g / count), Math.round(b / count)));
  }
  return out;
}
