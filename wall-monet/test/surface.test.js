// The tinted surface family: the deliberate deviation from the 2025 spec's
// tone-4 neutral surface, so that the bar / st / dmenu backgrounds carry the
// wallpaper's hue instead of rendering near-black.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hct, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import { SURFACE_TINT, accentContainers, tintedSurfaces } from '../src/surface.js';
import { ST_ALPHA, buildScheme, choosePalette, schemeValues } from '../src/scheme.js';
import { blendHex, relativeLuminance } from '../src/color.js';

const SEEDS = ['#2e6b8a', '#b3261e', '#3f7d20', '#e8c547', '#1a1a1a', '#c96fa8'];
const asHct = (hex) => Hct.fromInt(argbFromHex(hex));
const hueDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('the surface keeps the wallpaper hue and the configured chroma/tone', () => {
  for (const seed of SEEDS) {
    for (const dark of [true, false]) {
      const scheme = buildScheme(argbFromHex(seed), dark, 0);
      const tint = SURFACE_TINT[dark ? 'dark' : 'light'];
      const hct = asHct(tintedSurfaces(scheme, dark).norm_bg);
      // Tolerance is 5 deg because the colour makes a round trip through #rrggbb
      // before we measure it, which nudges the hue slightly (measured max 2.2).
      assert.ok(
        hueDistance(hct.hue, scheme.neutralPalette.hue) < 5,
        `${seed} dark=${dark}: hue drifted ${hct.hue.toFixed(1)} vs ${scheme.neutralPalette.hue.toFixed(1)}`,
      );
      assert.ok(Math.abs(hct.chroma - tint.chroma) < 4, `${seed}: chroma ${hct.chroma.toFixed(1)}`);
      assert.ok(Math.abs(hct.tone - tint.tone) < 3, `${seed}: tone ${hct.tone.toFixed(1)}`);
    }
  }
});

test('the surface is actually tinted, not the spec neutral', () => {
  // The whole point: the 2025 spec's surface has a chroma of 5 and reads as black.
  for (const seed of SEEDS) {
    const scheme = buildScheme(argbFromHex(seed), true, 0);
    const raw = asHct(schemeValues(scheme).norm_bg);
    const tinted = asHct(tintedSurfaces(scheme, true).norm_bg);
    assert.ok(tinted.chroma >= 8, `${seed}: tinted surface chroma is only ${tinted.chroma.toFixed(1)}`);
    assert.ok(tinted.chroma > raw.chroma * 1.5, `${seed}: ${tinted.chroma.toFixed(1)} vs raw ${raw.chroma.toFixed(1)}`);
  }
});

test('accentContainers uses the custom vivid tint and the error container', () => {
  for (const dark of [true, false]) {
    const scheme = buildScheme(argbFromHex('#8cd9e8'), dark, 0);
    const a = accentContainers(scheme, dark);
    const hue = scheme.primaryPalette.hue;
    assert.equal(a.tag_sel_bg, hexFromArgb(Hct.from(hue, 40, dark ? 26 : 88).toInt()));
    assert.equal(a.tag_hl_bg, hexFromArgb(Hct.from(hue, 40, dark ? 26 : 88).toInt()));
    assert.equal(a.tag_urg_bg, hexFromArgb(scheme.errorContainer));
    assert.equal(a.tag_sel_fg, hexFromArgb(Hct.from(hue, 10, dark ? 92 : 22).toInt()));
    assert.equal(a.tag_urg_fg, hexFromArgb(scheme.onErrorContainer));
  }
});

test('the tint reaches the palette, and st wears the surface colours', () => {
  for (const dark of [true, false]) {
    const chosen = choosePalette(argbFromHex('#8cd9e8'), dark);
    const scheme = buildScheme(argbFromHex('#8cd9e8'), dark, chosen.level);
    assert.equal(chosen.values.norm_bg, tintedSurfaces(scheme, dark).norm_bg);
    assert.equal(chosen.values.st_bg, chosen.values.norm_bg, 'st 底色 == surface');
    assert.equal(chosen.values.st_fg, chosen.values.norm_fg, 'st 文字 == onSurface');
    assert.equal(chosen.values.st_color0, chosen.values.st_bg, 'st 的 0 号槽与底色一致');
  }
});

test('a custom tint is honoured (the knob is not hard-coded inside the family)', () => {
  const scheme = buildScheme(argbFromHex('#8cd9e8'), true, 0);
  const strong = tintedSurfaces(scheme, true, { chroma: 30, tone: 16 });
  assert.ok(asHct(strong.norm_bg).chroma > asHct(tintedSurfaces(scheme, true).norm_bg).chroma);
  assert.ok(asHct(strong.norm_bg).tone > asHct(tintedSurfaces(scheme, true).norm_bg).tone);
});
