// The colour pipeline: are we really on the 2025 spec, is the role map complete,
// and does the contrast scan behave?
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hct, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import {
  CONTRAST_LEVELS,
  CONTRAST_MIN,
  ROLE_MAP,
  SPEC_VERSION,
  buildScheme,
  choosePalette,
  contrastPairs,
  schemeValues,
} from '../src/scheme.js';
import { isHex6 } from '../src/color.js';
import { KEY_ORDER, DEFAULT_ALPHA } from '../src/palette.js';
import { ST_KEYS } from '../src/st-colors.js';

const SEED = '#2e6b8a';

test('the scheme really is built on the 2025 spec, not silently downgraded', () => {
  // material-color-utilities 0.4.0 quietly falls back to '2021' for every
  // variant except EXPRESSIVE/VIBRANT/TONAL_SPOT/NEUTRAL, so this assertion is
  // the tripwire for a future upgrade changing that.
  const scheme = buildScheme(argbFromHex(SEED), true, 0);
  assert.equal(scheme.specVersion, SPEC_VERSION);
  assert.equal(scheme.specVersion, '2025');

  const on2025 = schemeValues(buildScheme(argbFromHex(SEED), true, 0, '2025'));
  const on2021 = schemeValues(buildScheme(argbFromHex(SEED), true, 0, '2021'));
  assert.notDeepEqual(on2025, on2021, 'the 2025 spec must actually change the output');
});

test('the 2025 spec really is a different colour spec, not a relabelled 2021', () => {
  const modern = buildScheme(argbFromHex(SEED), true, 0, '2025');
  const legacy = buildScheme(argbFromHex(SEED), true, 0, '2021');
  assert.equal(modern.specVersion, '2025');
  assert.equal(legacy.specVersion, '2021');

  // Measured differences between the two specs for this seed. If a future
  // library version collapses them, the palettes would silently change and this
  // is where it shows up.
  for (const role of ['surface', 'surfaceContainerHigh', 'primary', 'error', 'outlineVariant']) {
    assert.notEqual(
      hexFromArgb(modern[role]),
      hexFromArgb(legacy[role]),
      `${role} should differ between the 2021 and 2025 specs`,
    );
  }
});

test('the role map plus the derived st keys covers every key the palette emits', () => {
  // KEY_ORDER also holds the six tag keys (from accentContainers), tray_bg (from
  // the composited chip) and the nineteen st_* keys, none of which are a 1:1 role.
  const DERIVED = [
    'tag_sel_bg', 'tag_sel_fg', 'tag_hl_bg', 'tag_hl_fg', 'tag_urg_bg', 'tag_urg_fg',
    'tray_bg',
    ...ST_KEYS,
  ];
  const colourKeys = KEY_ORDER.filter((key) => !DERIVED.includes(key));
  assert.deepEqual(
    Object.keys(ROLE_MAP).sort(),
    [...colourKeys].sort(),
    'every emitted role key must have a role, and every role a key',
  );
  assert.equal(Object.keys(ROLE_MAP).length + DERIVED.length, KEY_ORDER.length);
});

test('every role resolves to a #rrggbb colour in both themes', () => {
  for (const dark of [true, false]) {
    for (const seed of ['#2e6b8a', '#b3261e', '#1a1a1a', '#ffffff']) {
      const values = schemeValues(buildScheme(argbFromHex(seed), dark, 0));
      for (const [key, value] of Object.entries(values)) {
        assert.ok(isHex6(value), `${key} = ${value} is not #rrggbb (seed ${seed}, dark=${dark})`);
      }
    }
  }
});

test('the contrast report covers all painted pairs', () => {
  const chosen = choosePalette(argbFromHex(SEED), true, 0);
  const report = contrastPairs(chosen.values);
  assert.equal(report.length, 5);
  assert.deepEqual(
    [...new Set(report.map((r) => r.key))].sort(),
    ['norm_fg', 'sel_fg', 'tag_hl_fg', 'tag_sel_fg', 'tag_urg_fg'].sort(),
  );
  for (const pair of report) assert.ok(pair.ratio > 0 && pair.ratio <= 21, `${pair.what} has a nonsense ratio`);
});

test('choosePalette reports the lowest passing level and never a phantom failure', () => {
  const chosen = choosePalette(argbFromHex(SEED), true);
  assert.ok(CONTRAST_LEVELS.includes(chosen.level));
  assert.equal(chosen.report.length, 5);
  assert.equal(chosen.pass, chosen.minRatio >= CONTRAST_MIN);
  assert.equal(chosen.shortfall, !chosen.pass);
  if (chosen.level === 0) assert.equal(chosen.escalated, false);
  assert.equal(chosen.minRatio, Math.min(...chosen.report.filter((r) => !r.advisory).map((r) => r.ratio)));
});

test('choosePalette still returns a usable palette for a pathological seed', () => {
  for (const seed of ['#000000', '#ffffff', '#7f7f7f']) {
    for (const dark of [true, false]) {
      const chosen = choosePalette(argbFromHex(seed), dark);
      assert.equal(Object.keys(chosen.values).length, Object.keys(ROLE_MAP).length + 6 + ST_KEYS.length + 1 /* tray_bg */);
      for (const value of Object.values(chosen.values)) assert.ok(isHex6(value));
      assert.ok(chosen.minRatio > 0);
    }
  }
});

test('the bar is genuinely translucent now that picom stops forcing opacity', () => {
  // The shipped values are 0x66 for the bar and 0xb3 for the chips; the palette's
  // DEFAULT_ALPHA is only the contrast model's bar alpha.
  assert.deepEqual(DEFAULT_ALPHA, { bar_alpha: 0x40, bar_bg_alpha: 0x40, bar_sel_alpha: 0x40 });
  const wallpaperShare = (255 - DEFAULT_ALPHA.bar_bg_alpha) / 255;
  assert.ok(wallpaperShare > 0.5, `wallpaper share is only ${(wallpaperShare * 100).toFixed(1)}%`);
});

test('the hue follows the wallpaper while the spec pins the chroma', () => {
  // Two facts this pins down, both easy to get wrong in the documentation:
  //   * TONAL_SPOT builds its primary palette as
  //     TonalPalette.fromHueAndChroma(sourceColorHct.hue, 36.0) -- the chroma is
  //     FIXED, the seed's own chroma is ignored. A greyscale wallpaper therefore
  //     does NOT produce a grey bar, and no chroma floor is being applied here;
  //     this is what the official pipeline does.
  //   * HCT reads neutral greys as hue 209.5 (blue), so that is the hue a grey
  //     wallpaper lands on.
  for (const seed of ['#808080', '#1a1a1a', '#2e6b8a', '#b3261e']) {
    const seedHue = Hct.fromInt(argbFromHex(seed)).hue;
    const values = schemeValues(buildScheme(argbFromHex(seed), true, 0));
    const bar = Hct.fromInt(argbFromHex(values.sel_bg));
    assert.ok(bar.chroma > 20, `${seed}: the palette is never grey, chroma came out ${bar.chroma.toFixed(1)}`);
    const delta = Math.abs(((bar.hue - seedHue + 540) % 360) - 180);
    assert.ok(delta < 15, `${seed}: hue should track the seed (${seedHue.toFixed(1)} vs ${bar.hue.toFixed(1)})`);
  }
});
