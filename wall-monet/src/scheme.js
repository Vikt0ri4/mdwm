// Seed -> the 22 palette keys, via the M3 Expressive 2025 colour spec.
//
// Two things about @material/material-color-utilities 0.4.0 that this module
// exists to get right:
//
//  1. "2025" is a *parameter* (specVersion), not a class. Worse, the package
//     silently downgrades it to '2021' for every variant except EXPRESSIVE,
//     VIBRANT, TONAL_SPOT and NEUTRAL (maybeFallbackSpecVersion()). We use
//     TONAL_SPOT, which is one of the four that honours it -- and the test
//     suite asserts that the 2025 spec actually changed the output, so a future
//     upgrade cannot quietly drop us back to 2021.
//
//  2. Readability is enforced by scanning the library's own contrastLevel
//     parameter (0 -> 0.5 -> 1) and taking the first level at which every
//     foreground/background pair we care about clears WCAG 4.5:1. The pairs are
//     not the naive (role, its own container) ones: they are the ones dwm
//     actually paints, including the translucent circles and chips, because dwm
//     composites those over the bar background before drawing text on top.
import { Hct, SchemeTonalSpot } from '@material/material-color-utilities';
import { argbToHex, blendHex, contrastRatio, isHex6 } from './color.js';
import { DEFAULT_ALPHA } from './palette.js';
import { stColors } from './st-colors.js';
import { TEXT_TONES, accentContainers, tintedSurfaces, tintedText } from './surface.js';

export const SPEC_VERSION = '2025';
// Only used by the 2025 spec's watch-specific tone forcing; 'phone' is what an
// X11 desktop should claim.
export const PLATFORM = 'phone';

/** dwm config.h: BAR_CHIP_ALPHA, the status/selected/urgent pill alpha. */
// 0x80: the pale containers need to be more solid than the 0x40 bar base, or
// they disappear into the wallpaper.
export const CHIP_ALPHA = 0xa0;

/** st's own `ST_ALPHA` from its config.h (0x80). */
export const ST_ALPHA = 0x80;

/**
 * palette key -> M3 color role.
 *
 * Grounded in how the patched dwm actually paints (dwm.c drawbar /
 * drawstatusbar / applypalette), which is not what the key names suggest:
 *
 *   tag_sel_bg -> chipclr, i.e. the chip pill behind every status segment and
 *                 the tray background, composited at chip_alpha (0xd9) over the
 *                 bar background. It is NOT the selected tag's background.
 *   tag_hl_bg  -> the circle behind the *selected* tag, composited at 50% over
 *                 the bar background.
 *   tag_hl_fg  -> the selected tag's text (tag_sel_fg is only its fallback).
 *   tag_urg_bg -> the circle behind an urgent tag, composited at 85%.
 *   bar_bg_fg  -> the base status text colour (scheme[LENGTH(colors)]).
 *   chip_bg    -> parsed by dwm and then never read: inert. It is written with
 *                 the same value as tag_sel_bg so the file stays consistent if
 *                 dwm is ever fixed to use it.
 *
 * Two mappings that look right on paper are provably unreadable here, so they
 * are deliberately NOT used (see test/contrast.test.js, which measures all 13
 * pairs dwm renders across 9 seeds x 2 themes x 3 contrast levels):
 *
 *   * Container roles (`primaryContainer`, `tertiaryContainer`, ...) are
 *     BACKGROUND colours: pale-tinted in light mode and mid-tone in dark mode.
 *     Used as the foreground of a status segment they measure as low as 1.02:1.
 *     Hence stat_* use foreground-safe roles only.
 *   * A tinted chip (`primaryContainer` at 0xd9 over the bar) sits at a very
 *     different luminance from the bar, and the status text drawn on it is also
 *     drawn on the bare bar, so no single text colour can serve both. Chips and
 *     tag circles therefore come from the surface family, which stays near the
 *     bar's luminance. This is also M3's canonical chip pairing
 *     (surfaceContainer + onSurfaceVariant).
 */
export const ROLE_MAP = {
  norm_fg: 'onSurface',
  norm_bg: 'surface',
  norm_border: 'outlineVariant',
  // NOT onPrimary. onPrimary is the "text on a primary band" role, and this dwm
  // never paints that band: drawbar() sets drw->nobg = 1 (dwm.c:1014) and
  // drw_text() only fills a background when "!drw->nobg || invert" (drw.c:398).
  // The selected title therefore lands straight on the bar, where a dark
  // onPrimary measures 1.00:1 -- unreadable, and no contrastLevel can repair a
  // role that is wrong for the surface it is drawn on. The accent itself is both
  // readable there and visually distinct from norm_fg, which is the whole point of
  // using SchemeSel for the title.
  sel_fg: 'primary',
  sel_bg: 'primary',
  sel_border: 'primary',
};

export const CONTRAST_MIN = 4.5;
export const CONTRAST_LEVELS = [0, 0.5, 1];

// The palette's own alpha defaults live in palette.js (they are palette values);
// ALPHA_DEFAULTS is re-exported here because that is where callers expect it.
export { DEFAULT_ALPHA as ALPHA_DEFAULTS };

/**
 * @param {string} [specVersion] only overridden by tests, to prove that the 2025
 *   spec is what we are actually on and that it differs from 2021.
 */
export function buildScheme(seedArgb, dark, contrastLevel, specVersion = SPEC_VERSION) {
  return new SchemeTonalSpot(Hct.fromInt(seedArgb), dark, contrastLevel, specVersion, PLATFORM);
}

/** Resolve ROLE_MAP against a scheme into `key -> #rrggbb`. */
export function schemeValues(scheme) {
  const values = {};
  for (const [key, role] of Object.entries(ROLE_MAP)) {
    const argb = scheme[role];
    if (typeof argb !== 'number') {
      throw new Error(`color role "${role}" (needed for ${key}) is unavailable on spec ${scheme.specVersion}`);
    }
    const hex = argbToHex(argb);
    if (!isHex6(hex)) throw new Error(`color role "${role}" produced ${hex}, which dwm would reject`);
    values[key] = hex;
  }
  return values;
}

/**
 * Every text/background pair dwm will actually render, using the *composited*
 * background wherever dwm blends a translucent circle, chip or the bar itself.
 *
 * The list is derived from the paint code, not from intuition:
 *   drawbar()        tags (selected circle / urgent circle / plain), title band
 *   drawstatusbar()  ^c<colour>^^p^<text>^d^ -- a chip pill behind each segment
 *   statusbar.sh     passes tag_sel_fg as the colour of every one of the six
 *                    segments (its stat_* lookups exist but are not emitted), so
 *                    stat_* are checked on the chip as well: they are written to
 *                    be usable the moment a statusbar revision starts using them
 *
 * Wallpaper awareness (`backdrops`): the bar window is 32-bit ARGB and dwm
 * paints it at bar_alpha, so the compositor blends it over the wallpaper. The
 * text therefore sits on `norm_bg @ bar_alpha over <whatever wallpaper pixel is
 * behind the bar>` -- and which pixel that is depends on both the wall paper and
 * the screen size, because feh --bg-fill crops and centres. Rather than guess a
 * screen geometry, callers pass the wallpaper's pixels and we enforce the worst
 * case across all of them. Without `backdrops` the bar is treated as opaque
 * (bar over itself), which is what the tests that predate this used.
 */
export function contrastPairs(values, { backdrops = null, barAlpha = DEFAULT_ALPHA.bar_bg_alpha } = {}) {
  const layers = backdrops && backdrops.length > 0 ? backdrops : [values.norm_bg];
  const barBgs = layers.map((under) => blendHex(values.norm_bg, under, barAlpha));
  // dwm draws the pills with PictOpSrc at BAR_CHIP_ALPHA: they replace the bar
  // in that region, so the composited backdrop is the chip over the wallpaper,
  // not the chip over the bar.
  const chipBgs = layers.map((under) => blendHex(values.tag_sel_bg, under, CHIP_ALPHA));
  const hlBgs = layers.map((under) => blendHex(values.tag_hl_bg, under, CHIP_ALPHA));
  const urgBgs = layers.map((under) => blendHex(values.tag_urg_bg, under, CHIP_ALPHA));

  const specs = [
    { key: 'norm_fg', what: 'bar text (before any status2d code, and after ^d^)', fg: values.norm_fg, bgs: barBgs },
    // The selected title is drawn with SchemeSel's FOREGROUND, but this dwm sets
    // drw->nobg = 1 in drawbar() and drw_text() only fills a background when
    // "!drw->nobg || invert" -- so the title text falls straight onto the bar.
    { key: 'sel_fg', what: 'selected title text on the bar (no band is painted)', fg: values.sel_fg, bgs: barBgs },
    { key: 'tag_hl_fg', what: 'selected tag text on its pill', fg: values.tag_hl_fg, bgs: hlBgs },
    { key: 'tag_urg_fg', what: 'urgent tag text on its pill', fg: values.tag_urg_fg, bgs: urgBgs },
    { key: 'tag_sel_fg', what: 'status segment text on a chip pill', fg: values.tag_sel_fg, bgs: chipBgs },
  ];

  return specs.map((spec) => {
    let worst = null;
    for (const bg of spec.bgs) {
      const ratio = contrastRatio(spec.fg, bg);
      if (worst === null || ratio < worst.ratio) worst = { bg, ratio };
    }
    return {
      key: spec.key,
      what: spec.what,
      fg: spec.fg,
      bg: worst.bg,
      ratio: worst.ratio,
      backgrounds: spec.bgs.length,
      advisory: false,
    };
  });
}

/**
 * Pick the lowest contrast level whose palette is readable everywhere.
 *
 * @param {object} [options] passed through to contrastPairs (see `backdrops`)
 * @returns {{ level: number, values: Record<string,string>, report: object[],
 *   minRatio: number, pass: boolean, escalated: boolean, shortfall: boolean }}
 */
export function choosePalette(seedArgb, dark, options = {}) {
  // Light is pinned to level 0 on purpose: the pale M3 containers are the
  // requested look, even when the wallpaper-aware contrast pass reports a
  // shortfall (the CLI warns). dark keeps the 0 -> 0.5 -> 1 escalation.
  const levels = dark ? CONTRAST_LEVELS : [0];
  const attempts = levels.map((level) => {
    const scheme = buildScheme(seedArgb, dark, level);
    // Order matters: role values -> tinted surface family -> st colours (which are
    // derived from the *final* norm_bg/norm_fg/sel_bg, so st's background is the
    // same colour as the bar's) -> contrast check on exactly what will be written.
    // st_bg == norm_bg and dmenu's -nb == norm_bg, so tinting the surface here is
    // what gives the bar, the terminal and dmenu a Monet background at once.
    const base = {
      ...schemeValues(scheme),
      ...tintedSurfaces(scheme, dark),
      ...accentContainers(scheme, dark),
    };
    // The bar is translucent enough that the text has to follow the wallpaper: over
    // a bright strip a light tint wins, over a dark or mid-grey one a dark tint does.
    // Rather than guess, build both and keep whichever reads better on this wallpaper.
    const stripMean = options.backdrops?.[0] ?? base.norm_bg;
    const barAsSeen = blendHex(base.norm_bg, stripMean, DEFAULT_ALPHA.bar_bg_alpha);
    const candidates = [TEXT_TONES.light, TEXT_TONES.dark].map((tone) => {
      const values = { ...base, ...tintedText(scheme, dark, tone) };
      // tray_bg is the chip colour as it appears on screen (chip over bar). The
      // dmenu window is opaque, so it needs this composited colour, not the raw
      // primary. (The dwm tray itself is shape-only since the bar refactor.)
      const withTray = { ...values, tray_bg: blendHex(values.tag_sel_bg, barAsSeen, CHIP_ALPHA) };
      const st = stColors(scheme, withTray, dark);
      const withSt = { ...withTray, ...st };
      const report = contrastPairs(withSt, options);
      const enforced = report.filter((r) => !r.advisory);
      return {
        values: withSt,
        report,
        minRatio: Math.min(...enforced.map((r) => r.ratio)),
        pass: enforced.every((r) => r.ratio >= CONTRAST_MIN),
        tone: tone.tone,
      };
    });
    const best = candidates.reduce((a, b) => (b.minRatio > a.minRatio ? b : a));
    return { level, tone: best.tone, ...best };
  });

  const winner =
    attempts.find((a) => a.pass) ??
    // Nothing cleared the bar even at maximum contrast: take the most readable
    // attempt and let the caller warn, rather than failing the whole run.
    attempts.reduce((best, a) => (a.minRatio > best.minRatio ? a : best));

  return { ...winner, escalated: winner.level !== 0, shortfall: !winner.pass };
}
