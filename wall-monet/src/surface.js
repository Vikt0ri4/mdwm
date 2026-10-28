// A deliberately tinted surface family.
//
// The 2025 spec puts the dark surface at tone 4 and the neutral palette's chroma
// at 5. At tone 4 the HCT colour space can barely hold any chroma, so the surface
// renders near-black -- and no amount of transparency changes that, because the
// problem is the colour, not the alpha.
//
// This module keeps the *hue* the wallpaper produced and rebuilds the surface
// family with enough chroma to actually read as "the wallpaper's colour", lifting
// the tone just enough to give that chroma somewhere to live. It is the older
// Material 3 (2021) surfaceTint behaviour, which the 2025 revision moved away
// from -- reintroduced on purpose, at the owner's request.
//
// Only the surface family is touched. The accents (primary/tertiary/error...)
// still come straight from SchemeTonalSpot, and every text pair is still checked
// by the wallpaper-aware contrast pass in scheme.js.
import { Hct, hexFromArgb } from '@material/material-color-utilities';

/**
 * Surface chroma/tone per theme. 12/10 is a visible but still calm dark teal.
 *
 * The tone is not free: HCT clamps chroma to the gamut at a given tone, and the
 * gamut is hue-dependent. Measured at chroma 22: the dark end at tone 14 keeps
 * 20.4 for every hue, and on the light end tone 88 collapses to 16.0 for a red
 * hue -- so a red wallpaper would get a paler, less tinted surface. Tone
 * 84 reaches ~22 for every hue (a saturated red only reaches 16.0 at 88), which is
 * why the light value is 84 and not the spec's 98.
 */
export const SURFACE_TINT = {
  dark: { chroma: 20, tone: 10 },
  light: { chroma: 20, tone: 84 },
};

/**
 * The bar's own text (and, through norm_fg, st's and dmenu's): a near-white that
 * still carries a trace of the wallpaper hue instead of pure #ffffff.
 *
 * At the very transparent bar alpha the text sits on the wallpaper more than on the
 * palette, so the tint has to stay faint: chroma 6 keeps 4.58:1 against a
 * mid-tone backdrop where chroma 10 already drops to 4.48:1.
 */
export const TEXT_TINT = { dark: { chroma: 6, tone: 97 }, light: { chroma: 6, tone: 12 } };

/** The two text candidates the palette picks between, per wallpaper. */
export const TEXT_TONES = {
  light: { chroma: 6, tone: 97 },
  dark: { chroma: 6, tone: 12 },
};

/**
 * @param {import('@material/material-color-utilities').DynamicScheme} scheme
 * @param {boolean} dark
 * @param {{chroma: number, tone: number}} [tint]
 * @returns {{norm_fg: string, sel_fg: string}}
 */
export function tintedText(scheme, dark, tint = TEXT_TINT[dark ? 'dark' : 'light']) {
  void dark;
  const hex = hexFromArgb(Hct.from(scheme.primaryPalette.hue, tint.chroma, tint.tone).toInt());
  // sel_fg too: with the bar this translucent the accent could not clear 4.5:1, and
  // the selected title is distinguished by the chips/tags rather than by its colour.
  return { norm_fg: hex, sel_fg: hex };
}

/**
 * Tone offset for the outline variant.
 */
const OFFSETS = {
  dark: { outlineVariant: 22 },
  light: { outlineVariant: -16 },
};

const clampTone = (tone) => Math.min(100, Math.max(0, Math.round(tone)));

/**
 * @param {import('@material/material-color-utilities').DynamicScheme} scheme
 * @param {boolean} dark
 * @param {{chroma: number, tone: number}} [tint]
 * @returns {Record<string,string>} the surface-family keys to override
 */
export function tintedSurfaces(scheme, dark, tint = SURFACE_TINT[dark ? 'dark' : 'light']) {
  const hue = scheme.neutralPalette.hue;
  const offsets = OFFSETS[dark ? 'dark' : 'light'];
  const at = (chroma, tone) => hexFromArgb(Hct.from(hue, chroma, clampTone(tone)).toInt());
  return {
    norm_bg: at(tint.chroma, tint.tone),
    norm_border: at(tint.chroma * 0.8, tint.tone + offsets.outlineVariant),
  };
}

/**
 * The accent chips (status pills, selected tag, urgent tag). Status/selected use
 * a custom high-chroma tint of the wallpaper's primary hue: the bar base is
 * tone ~84 / chroma ~20, so a standard container (tone ~90 / chroma ~16-32)
 * reads as "same lightness, barely more colour" and disappears at 0x66.
 * Light: tone 88 tint + tone 22 dark text. Dark: the inverse -- tone 26 tint
 * + tone 92 light text, same hue/chroma.
 *
 * @returns {Record<string,string>} tag_sel_bg, tag_sel_fg, tag_hl_bg, tag_hl_fg, tag_urg_bg, tag_urg_fg
 */
export function accentContainers(scheme, dark) {
  const at = (role) => hexFromArgb(scheme[role]);
  const hue = scheme.primaryPalette.hue;
  const tint = hexFromArgb(Hct.from(hue, 40, dark ? 26 : 88).toInt());
  const on = hexFromArgb(Hct.from(hue, 10, dark ? 92 : 22).toInt());
  return {
    tag_sel_bg: tint,
    tag_sel_fg: on,
    tag_hl_bg: tint,
    tag_hl_fg: on,
    tag_urg_bg: at('errorContainer'),
    tag_urg_fg: at('onErrorContainer'),
  };
}
