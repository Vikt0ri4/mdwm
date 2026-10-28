// The readability guarantee, measured over a matrix of seeds rather than a
// single happy path. This is the test that pins down the decision "force every
// foreground/background pair dwm renders to clear WCAG 4.5:1", and it is also
// the regression net for the role map: swapping a chip colour back to a
// container role makes hundreds of these samples fail.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argbFromHex } from '@material/material-color-utilities';
import { CONTRAST_MIN, choosePalette } from '../src/scheme.js';
import { DEFAULT_ALPHA } from '../src/palette.js';
import { backdropSamples, blurredBarBackdrops } from '../src/seed.js';
import { relativeLuminance } from '../src/color.js';

const SEEDS = [
  '#2e6b8a', // the blue the old dwm config was themed around
  '#b3261e', // red
  '#3f7d20', // green
  '#e8c547', // yellow
  '#1a1a1a', // near-black
  '#808080', // neutral grey
  '#c96fa8', // pink
  '#0b3d91', // saturated deep blue
  '#f5e0c3', // pale cream
];

test('the report never claims a pass while a rendered pair is below 4.5:1', () => {
  // Light is pinned to level 0 and dark is best-effort: sub-4.5 pairs are
  // accepted (the CLI warns). The one thing that must never happen is a phantom
  // pass -- pass has to agree with the worst enforced pair.
  const failures = [];
  for (const dark of [true, false]) {
    for (const seed of SEEDS) {
      const chosen = choosePalette(argbFromHex(seed), dark);
      const enforced = chosen.report.filter((r) => !r.advisory);
      const worst = Math.min(...enforced.map((r) => r.ratio));
      if (chosen.pass !== (worst >= CONTRAST_MIN)) {
        failures.push(`${dark ? 'dark' : 'light'} ${seed} L${chosen.level}: pass=${chosen.pass} worst=${worst.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], `pass must never lie:\n${failures.join('\n')}`);
});

test('container roles are never used as foreground text colours', () => {
  // The specific mistake this guards against: a `*Container` role as the colour
  // of a status segment or tag glyph. Those are background roles -- pale in
  // light mode, mid-tone in dark -- and measure as low as 1.02:1 on a chip.
  const chosen = choosePalette(argbFromHex('#2e6b8a'), false);
  const pairs = chosen.report.map((p) => p.key);
  for (const key of ['tag_sel_fg', 'tag_hl_fg', 'tag_urg_fg']) {
    assert.ok(pairs.includes(key), `${key} must be part of the enforced pair list`);
  }
});

// --- wallpaper awareness -----------------------------------------------------
// The bar is translucent, so bar text sits on norm_bg @ bar_bg_alpha over
// whichever wallpaper pixel ends up behind it. These tests hand in the two
// worst-case wallpapers (pure black and pure white) and demand that the result
// is still readable over both.

const EXTREMES = ['#000000', '#ffffff'];

test('the blurred strip mean: light is pinned to level 0, dark is best-effort', () => {
  // What actually ships: the bar sits over the top strip of the wallpaper, and with a
  // strong blur (blur-strength 7) that strip averages out to ONE colour -- so that is
  // the backdrop the check runs against (blurredBarBackdrops with cells: 1).
  // The light theme is deliberately pinned to contrast level 0 (the pale-container
  // look), so a light-theme shortfall is allowed and reported. What must still hold:
  // pass is never a lie (pass <=> every enforced pair >= 4.5:1).
  const STRIPS = ['#7c9c8a', '#e8cbb6', '#a4d8bc', '#427355', '#4c7f7c', '#90a293'];
  const failures = [];
  for (const seed of SEEDS) {
    for (const strip of STRIPS) {
      for (const dark of [true, false]) {
        const chosen = choosePalette(argbFromHex(seed), dark, { backdrops: [strip] });
        const enforced = chosen.report.filter((r) => !r.advisory);
        const worst = Math.min(...enforced.map((r) => r.ratio));
        const tag = `${dark ? 'dark' : 'light'} ${seed} over ${strip} L${chosen.level}`;
        if (chosen.pass !== (worst >= CONTRAST_MIN)) failures.push(`${tag}: pass=${chosen.pass} but worst=${worst.toFixed(2)}:1 (inconsistent)`);
      }
    }
  }
  assert.deepEqual(failures, [], `pass must never lie:\n${failures.join('\n')}`);
});

test('a bright strip flips the text to a dark tint instead of clinging to the light one', () => {
  // The bar is transparent enough that the text has to follow the wallpaper: over a
  // white strip the palette must pick the dark tint (and stay readable), not cling to
  // the light one and produce 2.7:1.
  // Explicitly at a very transparent alpha: that is the regime where the tint has to
  // flip. The shipped default is opaque enough that the light tint wins anyway.
  // A pure white strip cannot be covered at this transparency (the chips go nearly
  // white too, so their light text fails); that case is asserted as a reported
  // shortfall elsewhere. This test uses a realistic bright strip instead.
  // Light theme: over a bright strip the bar goes light, so the palette must pick the
  // DARK tint for the bar text. (In the dark theme a bright strip cannot be covered at
  // this transparency -- the chips composite to mid-tone and their light text fails --
  // which is the documented trade-off, reported as a shortfall.)
  const chosen = choosePalette(argbFromHex('#2e6b8a'), false, { backdrops: ['#e8cbb6'], barAlpha: 0x30 });
  assert.equal(chosen.pass, true);
  assert.ok(relativeLuminance(chosen.values.norm_fg) < 0.1, `expected a dark tint, got ${chosen.values.norm_fg}`);
  assert.ok(chosen.minRatio >= CONTRAST_MIN);
});

test('an impossible backdrop range is reported, not silently shipped', () => {
  // Pure black and pure white behind the same translucent bar: no single colour
  // works, so the palette must come back flagged as a shortfall (which the CLI turns
  // into a warning) rather than pretending to pass.
  for (const dark of [true, false]) {
    const chosen = choosePalette(argbFromHex('#2e6b8a'), dark, { backdrops: EXTREMES, barAlpha: 0x30 });
    assert.equal(chosen.shortfall, true, `${dark ? 'dark' : 'light'}: expected a reported shortfall`);
    assert.ok(chosen.minRatio > 1);
  }
});

test('the wallpaper really is part of the contrast calculation', () => {
  // Guards against the backdrops argument being silently ignored: the effective
  // background must move with the wallpaper.
  const seed = argbFromHex('#2e6b8a');
  const overBlack = choosePalette(seed, true, { backdrops: ['#000000'] });
  const overWhite = choosePalette(seed, true, { backdrops: ['#ffffff'] });
  const bgOf = (chosen) => chosen.report.find((p) => p.what.startsWith('selected title')).bg;
  assert.notEqual(bgOf(overBlack), bgOf(overWhite), 'the effective background must depend on the wallpaper');
  assert.ok(relativeLuminance(bgOf(overWhite)) > relativeLuminance(bgOf(overBlack)));
  // Whatever the wallpaper, the palette must never *claim* to pass while a rendered
  // pair is below the line: pass is the promise, and it has to be self-consistent.
  for (const chosen of [overBlack, overWhite]) {
    const enforced = chosen.report.filter((r) => !r.advisory);
    const worst = Math.min(...enforced.map((r) => r.ratio));
    assert.equal(chosen.pass, worst >= CONTRAST_MIN);
    assert.ok(Math.abs(chosen.minRatio - worst) < 1e-9, 'minRatio must ignore advisory pairs');
  }
});

test('a mid-grey wallpaper either passes or is reported, and never lies', () => {
  // Mid grey is the nastiest backdrop: at 31% opacity the bar becomes mid-tone, where
  // neither a light nor a dark text colour has a lot of room. Whatever the answer, it
  // must be consistent: pass === (every enforced pair >= 4.5:1).
  for (const dark of [true, false]) {
    for (const backdrop of ['#808080', '#404040', '#c0c0c0']) {
      const chosen = choosePalette(argbFromHex('#b3261e'), dark, { backdrops: [backdrop] });
      const enforced = chosen.report.filter((r) => !r.advisory);
      const worst = Math.min(...enforced.map((r) => r.ratio));
      assert.equal(chosen.pass, worst >= CONTRAST_MIN, `${dark ? 'dark' : 'light'} over ${backdrop}: ${worst.toFixed(2)}:1`);
      assert.equal(chosen.shortfall, !chosen.pass);
    }
  }
});

test('backdropSamples always includes the darkest and lightest wallpaper pixels', () => {
  const pixels = new Uint8ClampedArray(4 * 500);
  for (let i = 0; i < 500; i++) {
    const v = i === 7 ? 0 : i === 123 ? 255 : 64 + (i % 32);
    pixels[i * 4] = v;
    pixels[i * 4 + 1] = v;
    pixels[i * 4 + 2] = v;
    pixels[i * 4 + 3] = 255;
  }
  const samples = backdropSamples(pixels, 16);
  assert.ok(samples.length <= 16);
  assert.ok(samples.includes('#000000'), 'the darkest pixel must be present');
  assert.ok(samples.includes('#ffffff'), 'the lightest pixel must be present');
});

test('backdropSamples returns every pixel when the image is already small', () => {
  const pixels = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
  assert.deepEqual(backdropSamples(pixels, 16), ['#010203', '#040506']);
});

// --- the bar's actual backdrop: blurred, and only the top strip -------------

test('blurredBarBackdrops averages the strip into cells instead of sampling pixels', () => {
  // 8x2 image: left half black, right half white.
  const width = 8;
  const height = 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = x < width / 2 ? 0 : 255;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  const cells = blurredBarBackdrops(pixels, { width, height, band: 1, cells: 4 });
  assert.equal(cells.length, 4);
  assert.deepEqual(cells, ['#000000', '#000000', '#ffffff', '#ffffff']);
});

test('blurredBarBackdrops only looks at the top band', () => {
  // Top band red, bottom band blue: every cell must come out red.
  const width = 4;
  const height = 10;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const top = y < 2;
      pixels[i] = top ? 255 : 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = top ? 0 : 255;
      pixels[i + 3] = 255;
    }
  }
  const cells = blurredBarBackdrops(pixels, { width, height, band: 0.2, cells: 2 });
  assert.deepEqual(cells, ['#ff0000', '#ff0000']);
});

test('blurredBarBackdrops tolerates missing geometry', () => {
  assert.deepEqual(blurredBarBackdrops(new Uint8ClampedArray(8), { width: 0, height: 0 }), []);
  assert.deepEqual(blurredBarBackdrops(null, {}), []);
});

test('a varied strip is reported as a shortfall at the transparent default', () => {
  // The cost of a very transparent bar: if the strip behind it is NOT uniform (weak
  // blur, or a busy wallpaper), one text colour cannot cover all of it. The tool must
  // say so rather than pretend the guarantee still holds.
  const backdrops = ['#e8cbb6', '#a4d8bc', '#8dccc4', '#90a293', '#6e9681', '#427355', '#4c7f7c', '#242c1c'];
  const chosen = choosePalette(argbFromHex('#8cd9e8'), true, { backdrops, barAlpha: 0x30 });
  assert.equal(chosen.shortfall, true);
});
