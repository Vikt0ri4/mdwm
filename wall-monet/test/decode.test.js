// ffmpeg-backed decoding. Fixtures are generated on the fly from lavfi sources
// so the repository carries no binary test assets.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_MAX_EDGE, decodeImageToRgba } from '../src/decode.js';
import { seedFromRgba } from '../src/seed.js';
import { hexToRgb } from '../src/color.js';
import { makeImage, makeTmpDir } from './helpers.js';

test('a solid image decodes to opaque RGBA and seeds to that same colour', () => {
  const path = makeImage(join(makeTmpDir(), 'solid.png'), 'color=c=0x2e6b8a:s=64x64');
  const { pixels, pixelCount } = decodeImageToRgba(path);

  assert.equal(pixelCount, 64 * 64);
  assert.equal(pixels.length, pixelCount * 4);
  for (let i = 3; i < pixels.length; i += 4) {
    assert.equal(pixels[i], 255, 'every pixel must be opaque: material-color-utilities drops alpha < 255');
    if (i > 400) break;
  }

  const seed = seedFromRgba(pixels);
  const want = hexToRgb('#2e6b8a');
  const got = hexToRgb(seed.hex);
  // ffmpeg round-trips through yuv, so allow a couple of levels of drift.
  for (const channel of ['r', 'g', 'b']) {
    assert.ok(
      Math.abs(want[channel] - got[channel]) <= 8,
      `seed channel ${channel} drifted: wanted ${want[channel]}, got ${got[channel]} (${seed.hex})`,
    );
  }
});

test('a small image is never upscaled', () => {
  const path = makeImage(join(makeTmpDir(), 'tiny.png'), 'color=c=0xff0000:s=16x16');
  const { pixelCount } = decodeImageToRgba(path);
  assert.equal(pixelCount, 16 * 16, 'scale=min(maxEdge,iw) must leave a 16x16 image at 16x16');
});

test('a large image is downscaled to fit the sampling box, preserving aspect ratio', () => {
  const path = makeImage(join(makeTmpDir(), 'wide.png'), 'testsrc2=s=200x100');
  const { pixelCount } = decodeImageToRgba(path, { maxEdge: DEFAULT_MAX_EDGE });
  assert.equal(pixelCount, 128 * 64, '200x100 fitted into 128x128 becomes 128x64');
});

test('a real photograph would be downscaled too: the box is an upper bound', () => {
  const path = makeImage(join(makeTmpDir(), 'grad.png'), 'gradients=s=256x256');
  const { pixelCount } = decodeImageToRgba(path, { maxEdge: 32 });
  assert.ok(pixelCount <= 32 * 32);
  assert.ok(pixelCount > 0);
});

test('a missing or broken image fails loudly instead of yielding a bogus palette', () => {
  const missing = join(makeTmpDir(), 'nope.png');
  assert.throws(() => decodeImageToRgba(missing), /ffmpeg failed on .*nope\.png/);

  const junk = join(makeTmpDir(), 'junk.png');
  makeImage(junk, 'color=c=0x00ff00:s=8x8');
  const truncated = join(makeTmpDir(), 'truncated.png');
  writeFileSync(truncated, readFileSync(junk).subarray(0, 40));
  assert.throws(() => decodeImageToRgba(truncated), /ffmpeg failed/);
});

test('maxEdge is validated', () => {
  const path = makeImage(join(makeTmpDir(), 'a.png'), 'color=c=0x123456:s=8x8');
  assert.throws(() => decodeImageToRgba(path, { maxEdge: 0 }), /positive integer/);
  assert.throws(() => decodeImageToRgba(path, { maxEdge: 1.5 }), /positive integer/);
});

test('seedFromRgba rejects an empty pixel buffer', () => {
  assert.throws(() => seedFromRgba(new Uint8ClampedArray(0)), /at least one RGBA pixel/);
});
