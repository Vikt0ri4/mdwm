// st's colours, derived from the M3 scheme.
//
// The design (decided in review): the six semantic ANSI hues are LOCKED, while
// chroma and tone come from the scheme -- so the terminal still follows the
// wallpaper, but `git diff` keeps a red that reads as red and a green that reads
// as green. A pure role mapping would have made red/green collapse into whatever
// hue the wallpaper happens to have.
//
//   red      <- the error palette's own hue and chroma (error is red by design)
//   green    <- 140 deg, yellow 85, blue 250, magenta 320, cyan 190
//   chroma   <- the scheme's primary palette chroma (36 for tonal spot), clamped
//               to 32..48 so the six hues stay distinguishable
//   neutrals <- the scheme's neutral palette hue at chroma 5, at fixed tones
//
// The neutral tones are theme-aware on purpose: ANSI slot 0 is "black" and slot 7
// is "white", but in a light theme slot 0 must still be the darkest colour, or
// every program that assumes black-is-dark breaks.
import { Hct, hexFromArgb } from '@material/material-color-utilities';

/** Every key this module contributes to the palette. */
export const ST_KEYS = [
  ...Array.from({ length: 16 }, (_, i) => `st_color${i}`),
  'st_fg',
  'st_bg',
  'st_cursor',
];

/** Locked hues, in degrees. `red` is null because it follows the error palette. */
export const LOCKED_HUES = { red: null, green: 140, yellow: 85, blue: 250, magenta: 320, cyan: 190 };

const SLOTS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];
const NORMAL_TONE = { dark: 72, light: 45 };
const BRIGHT_TONE = { dark: 88, light: 30 };
const NEUTRAL_TONES = {
  dark: { 0: 8, 8: 32, 7: 80, 15: 98 },
  light: { 0: 20, 8: 50, 7: 85, 15: 100 },
};

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * @param {import('@material/material-color-utilities').DynamicScheme} scheme
 * @param {Record<string,string>} values the palette's M3 role values
 * @param {boolean} dark
 * @returns {Record<string,string>} the ST_KEYS colours
 */
export function stColors(scheme, values, dark) {
  const theme = dark ? 'dark' : 'light';
  const chroma = clamp(scheme.primaryPalette.chroma, 32, 48);
  const neutralHue = scheme.neutralPalette.hue;
  const neutralChroma = scheme.neutralPalette.chroma;
  const neutral = (tone) => hexFromArgb(Hct.from(neutralHue, neutralChroma, tone).toInt());
  const errorHue = scheme.errorPalette.hue;
  const errorChroma = Math.max(chroma, scheme.errorPalette.chroma);

  const out = {
    // Decoupled from the status chip: the bar's pills are now the accent primary,
    // and making the terminal wear that would turn it into a dark primary screen
    // (and st_cursor == st_bg would vanish). st uses the surface instead.
    st_fg: values.norm_fg,
    st_bg: values.norm_bg,
    st_cursor: values.sel_bg,
  };

  for (const [index, tone] of Object.entries(NEUTRAL_TONES[theme])) {
    out[`st_color${index}`] = neutral(tone);
  }
  SLOTS.forEach((name, i) => {
    const hue = name === 'red' ? errorHue : LOCKED_HUES[name];
    const slotChroma = name === 'red' ? errorChroma : chroma;
    out[`st_color${i + 1}`] = hexFromArgb(Hct.from(hue, slotChroma, NORMAL_TONE[theme]).toInt());
    out[`st_color${i + 9}`] = hexFromArgb(Hct.from(hue, slotChroma, BRIGHT_TONE[theme]).toInt());
  });

  // st's config.h sets defaultfg = 7, defaultbg = 0, defaultcs = 4, which makes
  // the terminal's foreground, background and cursor ALIASES for palette slots.
  // OSC 10/11/12 and OSC 4;7/0/4 therefore write the same slot, and whichever
  // sequence arrives last wins -- so give them identical values and the ordering
  // stops mattering. Consequence: the "blue" slot (4) carries the cursor colour,
  // and the bright half keeps the locked blue at slot 12.
  out.st_color0 = out.st_bg;
  out.st_color7 = out.st_fg;
  out.st_color4 = out.st_cursor;
  return out;
}

/**
 * The escape sequences that retint a running st: sixteen OSC 4 (palette) writes
 * followed by OSC 10/11/12 (fg/bg/cursor).
 *
 * The order is irrelevant *because* st_color0/7/4 were made identical to
 * st_bg/st_fg/st_cursor above -- st's config aliases those slots, so both groups
 * of sequences write the same value twice.
 */
export function oscSequences(values) {
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const colour = values[`st_color${i}`];
    if (colour) parts.push(`\u001b]4;${i};${colour}\u0007`);
  }
  for (const [code, key] of [[10, 'st_fg'], [11, 'st_bg'], [12, 'st_cursor']]) {
    if (values[key]) parts.push(`\u001b]${code};${values[key]}\u0007`);
  }
  return parts.join('');
}
