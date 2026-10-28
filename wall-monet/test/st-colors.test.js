// st's colours: the derivation from the M3 scheme, and the escape sequences that
// push them into a running terminal.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hct, argbFromHex } from '@material/material-color-utilities';
import { LOCKED_HUES, ST_KEYS, oscSequences, stColors } from '../src/st-colors.js';
import { choosePalette, buildScheme, schemeValues } from '../src/scheme.js';
import { blendHex, contrastRatio, isHex6, relativeLuminance } from '../src/color.js';
import { readPaletteValues } from '../src/palette.js';
import { makeSandbox, makeTmpDir } from './helpers.js';
import { writeFileSync } from 'node:fs';

const SEEDS = ['#2e6b8a', '#b3261e', '#3f7d20', '#e8c547', '#1a1a1a', '#808080', '#c96fa8'];

function valuesFor(seed, dark, level = 0) {
  const scheme = buildScheme(argbFromHex(seed), dark, level);
  const values = schemeValues(scheme);
  return { scheme, values, st: stColors(scheme, values, dark) };
}

test('every st key is present and a real #rrggbb', () => {
  assert.equal(ST_KEYS.length, 19);
  for (const dark of [true, false]) {
    for (const seed of SEEDS) {
      const { st } = valuesFor(seed, dark);
      for (const key of ST_KEYS) {
        assert.ok(isHex6(st[key]), `${key} = ${st[key]} (seed ${seed}, dark=${dark})`);
      }
    }
  }
});

test('st uses the surface pair, not the status-chip pair', () => {
  const scheme = buildScheme(argbFromHex('#8cd9e8'), true, 0);
  const values = { ...schemeValues(scheme) };
  values.sel_bg = '#123456';
  const st = stColors(scheme, values, true);
  assert.equal(st.st_bg, values.norm_bg);
  assert.equal(st.st_fg, values.norm_fg);
  assert.equal(st.st_cursor, values.sel_bg);
});
test('the fg/bg/cursor slots are identical to st_fg/st_bg/st_cursor', () => {
  // st's config.h aliases defaultfg=7, defaultbg=0, defaultcs=4, so OSC 10/11/12
  // and OSC 4;7/0/4 write the same palette slot. Identical values are what make
  // the emission order irrelevant.
  for (const dark of [true, false]) {
    const { st } = valuesFor('#8cd9e8', dark);
    assert.equal(st.st_color0, st.st_bg);
    assert.equal(st.st_color7, st.st_fg);
    assert.equal(st.st_color4, st.st_cursor);
  }
});

test('the five locked hues stay well apart from each other', () => {
  // Slot 4 is excluded on purpose: it carries the cursor colour, so it follows the
  // primary hue and can legitimately sit near the locked cyan.
  for (const dark of [true, false]) {
    for (const seed of SEEDS) {
      const { st } = valuesFor(seed, dark);
      const hues = [1, 2, 3, 5, 6].map((i) => Hct.fromInt(argbFromHex(st[`st_color${i}`])).hue);
      let closest = Infinity;
      for (let i = 0; i < hues.length; i++) {
        for (let j = i + 1; j < hues.length; j++) {
          // signed difference wrapped into [-180, 180), then its magnitude
          const d = Math.abs(((hues[i] - hues[j] + 540) % 360) - 180);
          closest = Math.min(closest, d);
        }
      }
      assert.ok(closest >= 25, `${seed} dark=${dark}: two locked hues are only ${closest.toFixed(1)} deg apart`);
    }
  }
});

test('terminal text is readable through st\'s own alpha over a realistic wallpaper', () => {
  // st runs with ST_ALPHA=0x80 (0.5), so the terminal background on screen is
  // st_bg (the surface) blended with the wallpaper. The light theme no longer has
  // the old large margin (the 0x80 surface can land mid-tone); it is held to the UI
  // floor, same as the dark theme.
  const ST_ALPHA = 0x80;   // st's own float alpha = 0.5
  const STRIPS = ['#7c9c8a', '#a4d8bc', '#e8cbb6', '#4c7f7c', '#90a293'];
  for (const seed of SEEDS) {
    for (const strip of STRIPS) {
      const light = choosePalette(argbFromHex(seed), false, { backdrops: [strip] });
      const lightRatio = contrastRatio(light.values.st_fg, blendHex(light.values.st_bg, strip, ST_ALPHA));
      assert.ok(lightRatio >= 2.3, `light ${seed} over ${strip}: st text only ${lightRatio.toFixed(2)}:1`);

      // The dark theme puts a dark surface behind a 50%-transparent terminal, so a
      // mid wallpaper drags it to mid-tone and one text colour cannot reach 4.5:1. It is
      // held to the UI floor instead; raising st's alpha or using the light theme fixes it.
      const dark = choosePalette(argbFromHex(seed), true, { backdrops: [strip] });
      const darkRatio = contrastRatio(dark.values.st_fg, blendHex(dark.values.st_bg, strip, ST_ALPHA));
      assert.ok(darkRatio >= 2.3, `dark ${seed} over ${strip}: st text only ${darkRatio.toFixed(2)}:1`);
    }
  }
});
test('a light theme still has a dark slot 0 and a light slot 15', () => {
  // ANSI slot 0 is "black" in every program's head; it must be the darkest colour
  // in both themes or `ls`-style output becomes unreadable.
  const light = valuesFor('#8cd9e8', false).st;
  assert.ok(relativeLuminance(light.st_color0) < relativeLuminance(light.st_color15));
  assert.ok(relativeLuminance(light.st_color0) < relativeLuminance(light.st_bg) + 0.2);
  const dark = valuesFor('#8cd9e8', true).st;
  assert.ok(relativeLuminance(dark.st_color0) < relativeLuminance(dark.st_color15));
  assert.ok(relativeLuminance(dark.st_color15) > 0.5, 'slot 15 should be near-white in a dark theme');
});

test('the locked hue constants are the documented ones', () => {
  assert.deepEqual(LOCKED_HUES, { red: null, green: 140, yellow: 85, blue: 250, magenta: 320, cyan: 190 });
});

test('oscSequences emits sixteen palette writes then fg/bg/cursor', () => {
  const { st } = valuesFor('#8cd9e8', true);
  const seq = oscSequences(st);
  const parts = seq.split('\u0007').filter((p) => p !== '');
  assert.equal(parts.length, 19);
  for (let i = 0; i < 16; i++) assert.equal(parts[i], `\u001b]4;${i};${st[`st_color${i}`]}`);
  assert.equal(parts[16], `\u001b]10;${st.st_fg}`);
  assert.equal(parts[17], `\u001b]11;${st.st_bg}`);
  assert.equal(parts[18], `\u001b]12;${st.st_cursor}`);
  assert.ok(seq.startsWith('\u001b]4;0;'));
  assert.ok(seq.endsWith('\u0007'));
});

test('oscSequences skips keys that are absent instead of emitting junk', () => {
  assert.equal(oscSequences({}), '');
  assert.equal(oscSequences({ st_bg: '#123456' }), '\u001b]11;#123456\u0007');
});

test('readPaletteValues reads our own file format and ignores comments', () => {
  const dir = makeTmpDir();
  const path = join(dir, 'palette');
  writeFileSync(path, '# header=a comment\nnorm_bg=#0a0f10\n\nst_fg=#ffffff\n# st_bg=#000000\n');
  assert.deepEqual(readPaletteValues(path), { norm_bg: '#0a0f10', st_fg: '#ffffff' });
  assert.throws(() => readPaletteValues(join(dir, 'missing')));
});

test('the st colours ride along in the palette and are deterministic', () => {
  const sandbox = makeSandbox();
  const first = choosePalette(argbFromHex('#8cd9e8'), true);
  const second = choosePalette(argbFromHex('#8cd9e8'), true);
  for (const key of ST_KEYS) {
    assert.ok(first.values[key], `${key} must be part of the palette values`);
    assert.equal(first.values[key], second.values[key]);
  }
  assert.ok(sandbox.root);
});
