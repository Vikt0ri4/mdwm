// Wallpaper discovery (parsing feh's ~/.fehbg) and application.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  IMAGE_EXTENSIONS,
  applyWallpaper,
  currentWallpaper,
  listWallpapers,
  parseFehbg,
  pickRandom,
  tokenize,
} from '../src/wallpaper.js';
import { makeImage, makeTmpDir, readStubLog } from './helpers.js';

test('tokenize handles quotes, escapes and runs of spaces', () => {
  assert.deepEqual(tokenize(`feh --bg-fill '/a b/c.png'`), ['feh', '--bg-fill', '/a b/c.png']);
  assert.deepEqual(tokenize('feh --bg-fill "/a b/c.png"'), ['feh', '--bg-fill', '/a b/c.png']);
  assert.deepEqual(tokenize('feh   --bg-fill   /x.png'), ['feh', '--bg-fill', '/x.png']);
  assert.deepEqual(tokenize('feh --bg-fill /a\\ b.png'), ['feh', '--bg-fill', '/a b.png']);
  assert.deepEqual(tokenize(''), []);
});

test('parseFehbg finds the image in the shapes feh actually writes', () => {
  assert.equal(parseFehbg(`feh --bg-fill '/home/u/图片/a b.jpg'\n`), '/home/u/图片/a b.jpg');
  assert.equal(parseFehbg('feh --no-fehbg --bg-fill /w/x.png\n'), '/w/x.png');
  assert.equal(parseFehbg('#!/bin/sh\nfeh --bg-scale /w/y.jpg\n'), '/w/y.jpg');
  assert.equal(parseFehbg('#!/bin/sh\n\n# comment\nfeh --bg-fill /w/z.webp\n'), '/w/z.webp');
  assert.equal(parseFehbg('feh --bg-fill /first.png\nfeh --bg-fill /second.png\n'), '/first.png');
  assert.equal(parseFehbg('feh --bg-fill /w/not-an-image.txt\n'), null);
  assert.equal(parseFehbg(''), null);
  assert.equal(parseFehbg('# only a comment\n'), null);
});

test('the image extension list covers what feh can actually display', () => {
  for (const name of ['a.jpg', 'a.JPEG', 'a.png', 'a.webp', 'a.bmp', 'a.gif', 'a.avif', 'a.tiff']) {
    assert.ok(IMAGE_EXTENSIONS.test(name), `${name} should be recognised`);
  }
  assert.equal(IMAGE_EXTENSIONS.test('a.txt'), false);
});

test('currentWallpaper reads the recorded wallpaper and explains itself when there is none', () => {
  const home = makeTmpDir();
  const env = { HOME: home };
  assert.throws(() => currentWallpaper(env), /\.fehbg does not exist/);

  writeFileSync(join(home, '.fehbg'), `feh --bg-fill '${home}/w/a.png'\n`, { mode: 0o755 });
  assert.equal(currentWallpaper(env), `${home}/w/a.png`);

  writeFileSync(join(home, '.fehbg'), '#!/bin/sh\ntrue\n');
  assert.throws(() => currentWallpaper(env), /no image path found/);
});

test('listWallpapers filters, sorts and skips directories', () => {
  const dir = makeTmpDir();
  makeImage(join(dir, 'b.png'), 'color=c=0x010203:s=8x8');
  makeImage(join(dir, 'a.jpg'), 'color=c=0x030201:s=8x8');
  writeFileSync(join(dir, 'notes.txt'), 'ignore me');
  mkdirSync(join(dir, 'subdir.png'));

  const found = listWallpapers(dir);
  assert.deepEqual(found, [join(dir, 'a.jpg'), join(dir, 'b.png')]);

  assert.throws(() => listWallpapers(join(dir, 'missing')), /cannot read the wallpaper directory/);
});

test('pickRandom is bounded and rejects an empty list', () => {
  const list = ['a', 'b', 'c'];
  assert.equal(pickRandom(list, () => 0), 'a');
  assert.equal(pickRandom(list, () => 0.5), 'b');
  assert.equal(pickRandom(list, () => 0.999), 'c');
  assert.equal(pickRandom(list, () => 1), 'c', 'a stub returning exactly 1 must not fall off the end');
  assert.throws(() => pickRandom([], Math.random), /no wallpaper to pick from/);
});

test('applyWallpaper calls feh --bg-fill and reports its failure', () => {
  const dir = makeTmpDir();
  const log = join(dir, 'log');
  const feh = join(dir, 'feh');
  writeFileSync(feh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`, { mode: 0o755 });
  chmodSync(feh, 0o755);

  const image = join(dir, 'wall.png');
  applyWallpaper(image, { feh });
  assert.deepEqual(readStubLog(log), [`--bg-fill ${image}`]);

  const failing = join(dir, 'feh-fail');
  writeFileSync(failing, '#!/bin/sh\necho "boom" >&2\nexit 3\n', { mode: 0o755 });
  chmodSync(failing, 0o755);
  assert.throws(() => applyWallpaper(image, { feh: failing }), /failed to set .*\(exit 3\): boom/);

  assert.throws(() => applyWallpaper(image, { feh: join(dir, 'absent') }), /could not run/);
});
