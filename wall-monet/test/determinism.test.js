// Reproducibility. material-color-utilities' QuantizerWsmeans uses Math.random()
// internally, so without pinning the random stream the same wallpaper yields a
// different palette on every run -- and every press of Super+Shift+W would drift
// the bar's colours. These tests exist because the bug is invisible in any
// single run and only shows up when you compare two.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { decodeImageToRgba } from '../src/decode.js';
import { seedFromRgba } from '../src/seed.js';
import { makeImage, makeSandbox, makeTmpDir, runCli, testEnv } from './helpers.js';

/** A multi-cluster image, so the quantizer actually has a choice to make. */
function busyImage(dir, name = 'busy.png') {
  return makeImage(join(dir, name), 'testsrc2=s=160x120');
}

test('the same pixels always produce the same seed', () => {
  const image = busyImage(makeTmpDir());
  const { pixels } = decodeImageToRgba(image);
  const seeds = new Set();
  for (let i = 0; i < 5; i++) seeds.add(seedFromRgba(pixels).hex);
  assert.equal(seeds.size, 1, `expected one stable seed, got ${[...seeds].join(', ')}`);
});

test('the pinned random stream does not leak into the rest of the process', () => {
  const saved = Math.random;
  seedFromRgba(decodeImageToRgba(busyImage(makeTmpDir())).pixels);
  assert.equal(Math.random, saved, 'Math.random must be restored, even on success');
});

test('two separate CLI runs agree on the seed and the palette', () => {
  const sandbox = makeSandbox();
  const image = busyImage(sandbox.wallDir, 'wall.png');
  const env = testEnv(sandbox);

  const strip = (text) => text.split('\n').filter((line) => !line.startsWith('# generated=')).join('\n');
  const first = runCli(['--print', '--dark', image], { env });
  const second = runCli(['--print', '--dark', image], { env });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(strip(first.stdout), strip(second.stdout), 'the palette must not drift between runs');

  const seedOf = (text) => text.match(/^# seed=(.*)$/m)[1];
  assert.equal(seedOf(first.stdout), seedOf(second.stdout));
});

test('a different image still yields a different seed', () => {
  // Guards the fix from collapsing into "always return the same colour".
  const dir = makeTmpDir();
  const warm = makeImage(join(dir, 'warm.png'), 'color=c=0xb3261e:s=64x64');
  const cool = makeImage(join(dir, 'cool.png'), 'color=c=0x0b3d91:s=64x64');
  const a = seedFromRgba(decodeImageToRgba(warm).pixels).hex;
  const b = seedFromRgba(decodeImageToRgba(cool).pixels).hex;
  assert.notEqual(a, b);
});
