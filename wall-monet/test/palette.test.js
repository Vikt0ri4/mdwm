// Palette rendering, validation, atomic writes and the theme state file.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_ALPHA,
  KEY_ORDER,
  flipTheme,
  readTheme,
  renderPalette,
  validatePalette,
  writeAtomic,
  writeTheme,
} from '../src/palette.js';
import { parseAsDwm } from '../src/dwm-parse.js';
import { ST_KEYS } from '../src/st-colors.js';
import { makeTmpDir } from './helpers.js';

const VALUES = Object.fromEntries(KEY_ORDER.map((key, i) => [key, `#${(i + 1).toString(16).padStart(2, '0')}aabb`.slice(0, 7)]));

function render(overrides = {}) {
  return renderPalette({
    image: '/walls/some image.png',
    theme: 'dark',
    seed: '#2e6b8a',
    generated: '2026-10-24T09:00:00.000Z',
    values: VALUES,
    ...overrides,
  });
}

test('the rendered palette has a comment header and one key=value per line', () => {
  const text = render();
  const lines = text.split('\n').filter((line) => line !== '');
  const headers = lines.filter((line) => line.startsWith('#'));
  const body = lines.filter((line) => !line.startsWith('#'));

  assert.equal(headers.length, 5);
  assert.match(headers[0], /^# wall-monet palette/);
  assert.ok(headers.some((line) => line === '# image=/walls/some image.png'));
  assert.ok(headers.some((line) => line === '# theme=dark'));
  assert.ok(headers.some((line) => line === '# seed=#2e6b8a'));
  assert.ok(headers.some((line) => line.startsWith('# generated=')));

  assert.equal(body.length, KEY_ORDER.length);
  assert.deepEqual(body.map((line) => line.split('=')[0]), KEY_ORDER);
  for (const line of body) {
    assert.doesNotMatch(line, /\s/, `no whitespace is allowed around '=': ${line}`);
    assert.match(line, /^[a-z_0-9]+=#[0-9a-f]{6}$/);
  }
  assert.ok(text.endsWith('\n'));
});

test('dwm accepts what we render', () => {
  const result = parseAsDwm(render());
  assert.equal(result.accepted, true);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.suspicious, []);
  // dwm does not know the st_* keys, so it ignores them -- which is exactly the
  // property that lets one file serve every consumer.
  assert.deepEqual(result.ignored.slice().sort(), ST_KEYS.slice().sort());
});

test('a newline smuggled into a header value cannot corrupt the file', () => {
  const text = render({ image: '/walls/a\nnorm_fg=#000000\nb.png' });
  const result = parseAsDwm(text);
  assert.equal(result.accepted, true);
  assert.equal(result.colors.norm_fg, VALUES.norm_fg, 'the injected line must not take effect');
  assert.equal(text.split('\n').filter((l) => l.startsWith('# image=')).length, 1);
});

test('validatePalette refuses to emit anything dwm would reject', () => {
  assert.equal(validatePalette(VALUES), true);
  assert.throws(() => validatePalette({ ...VALUES, norm_fg: '#abc' }), /dwm requires #rrggbb/);
  assert.throws(() => validatePalette({ ...VALUES, tag_sel_bg: undefined }), /dwm requires #rrggbb/);
  assert.throws(() => validatePalette({ ...VALUES, st_bg: 'no' }), /dwm requires #rrggbb/);
});

test('writeAtomic creates the directory, writes the file and leaves no debris', () => {
  const dir = join(makeTmpDir(), 'a', 'b');
  const path = join(dir, 'palette');
  writeAtomic(path, 'hello\n');
  assert.equal(readFileSync(path, 'utf8'), 'hello\n');
  assert.deepEqual(readdirSync(dir), ['palette'], 'no temp file may survive the rename');
  assert.equal(statSync(path).mode & 0o777, 0o644);
});

test('writeAtomic overwrites in place', () => {
  const dir = makeTmpDir();
  const path = join(dir, 'palette');
  writeAtomic(path, 'first\n');
  writeAtomic(path, 'second\n');
  assert.equal(readFileSync(path, 'utf8'), 'second\n');
  assert.deepEqual(readdirSync(dir), ['palette']);
});

test('theme state round-trips as a single line and tolerates junk', () => {
  const dir = makeTmpDir();
  assert.equal(readTheme(dir), null, 'a missing file means "no remembered theme"');

  writeTheme(dir, 'light');
  assert.equal(readFileSync(join(dir, 'theme'), 'utf8'), 'light\n');
  assert.equal(readTheme(dir), 'light');

  writeAtomic(join(dir, 'theme'), 'sepia\n');
  assert.equal(readTheme(dir), null, 'an unknown theme is treated as absent');

  assert.throws(() => writeTheme(dir, 'sepia'), /unknown theme/);
  assert.equal(flipTheme('dark'), 'light');
  assert.equal(flipTheme('light'), 'dark');
});

test('writeAtomic reports a failure instead of leaving a half-written palette', () => {
  const dir = makeTmpDir();
  const path = join(dir, 'palette');
  mkdirSync(path); // make the target a directory so the rename must fail
  assert.throws(() => writeAtomic(path, 'nope\n'));
  assert.ok(existsSync(path));
  assert.deepEqual(readdirSync(dir), ['palette'], 'the temp file must be cleaned up');
});
