// The palette parser is a port of parsepalette() in the monet-patched dwm.c.
// These cases exist because each one is a way for a palette to be silently
// thrown away, which shows up as "the bar just did not change colour".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REQUIRED_KEYS, parseAsDwm } from '../src/dwm-parse.js';

const VALID = {
  norm_fg: '#dfe6ed',
  norm_bg: '#0b0f11',
  norm_border: '#42494f',
  sel_fg: '#1d445a',
  sel_bg: '#a6cbe6',
  sel_border: '#a6cbe6',
};

function paletteText(overrides = {}, extraLines = []) {
  const values = { ...VALID, ...overrides };
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .concat(extraLines)
    .join('\n') + '\n';
}

test('a complete palette is accepted', () => {
  const result = parseAsDwm(paletteText());
  assert.equal(result.accepted, true);
  assert.deepEqual(result.missingRequired, []);
  assert.equal(result.foundRequired.length, REQUIRED_KEYS.length);
});

test('one missing required key rejects the whole file', () => {
  for (const key of REQUIRED_KEYS) {
    const reduced = { ...VALID };
    delete reduced[key];
    // Built directly rather than through paletteText(), which would merge the
    // removed key straight back in.
    const text = Object.entries(reduced).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    const result = parseAsDwm(text);
    assert.equal(result.accepted, false, `dropping ${key} must reject the file`);
    assert.deepEqual(result.missingRequired, [key]);
  }
});

test('the key is everything before the first = and is never trimmed', () => {
  const result = parseAsDwm(paletteText({}, []).replace('norm_fg=', 'norm_fg ='));
  assert.equal(result.accepted, false);
  assert.ok(result.missingRequired.includes('norm_fg'), 'a space before = renames the key, so norm_fg is missing');
});

test('the value is never trimmed either', () => {
  const result = parseAsDwm(paletteText().replace('norm_fg=#dfe6ed', 'norm_fg=#dfe6ed '));
  assert.equal(result.accepted, false);
  assert.ok(result.missingRequired.includes('norm_fg'));
});

test('uppercase hex is fine but a short or long value is not', () => {
  assert.equal(parseAsDwm(paletteText({ norm_fg: '#DFE6ED' })).accepted, true);
  assert.equal(parseAsDwm(paletteText({ norm_fg: '#abc' })).accepted, false);
  assert.equal(parseAsDwm(paletteText({ norm_fg: '#dfe6ed0' })).accepted, false);
  assert.equal(parseAsDwm(paletteText({ norm_fg: 'dfe6ed' })).accepted, false);
});

test('a line is a comment only when # is its first character', () => {
  const commented = parseAsDwm(`# norm_fg=#dfe6ed\n${paletteText()}`);
  assert.equal(commented.accepted, true, 'the comment line is skipped and the real key is still found');
  assert.deepEqual(commented.ignored, []);

  // An indented line is NOT a comment: it is parsed as the unknown key
  // " # norm_fg", so it contributes nothing.
  const indented = parseAsDwm(paletteText({}, [' # norm_fg=#dfe6ed']));
  assert.equal(indented.accepted, true);
  assert.deepEqual(indented.ignored, [' # norm_fg']);
  assert.equal(indented.colors.norm_fg, '#dfe6ed', 'the real line is still the one that counts');
});

test('CRLF line endings are tolerated because dwm truncates at the first \\r', () => {
  const result = parseAsDwm(paletteText().replace(/\n/g, '\r\n'));
  assert.equal(result.accepted, true);
});

test('a value is truncated at an embedded \\r', () => {
  const result = parseAsDwm(paletteText().replace('norm_fg=#dfe6ed', 'norm_fg=#dfe6ed\r#junk'));
  assert.equal(result.accepted, true);
  assert.equal(result.colors.norm_fg, '#dfe6ed');
});

test('unknown keys are ignored without invalidating the file', () => {
  const result = parseAsDwm(paletteText({}, ['future_key=#123456']));
  assert.equal(result.accepted, true);
  assert.deepEqual(result.ignored, ['future_key']);
});

test('alpha values follow strtol: leading whitespace and + are allowed, trailing junk is not', () => {
  const accepted = parseAsDwm(paletteText({}, ['bar_alpha= 16', 'bar_bg_alpha=+217', 'bar_sel_alpha=255']));
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.alphas.bar_alpha, 16);
  assert.equal(accepted.alphas.bar_bg_alpha, 217);
  assert.equal(accepted.alphaSource.bar_alpha, 'file');

  const rejected = parseAsDwm(paletteText({}, ['bar_alpha=16 ', 'bar_bg_alpha=256', 'bar_sel_alpha=-1', 'bar_alpha=0x10']));
  assert.equal(rejected.accepted, true, 'a bad alpha never invalidates the file');
  assert.equal(rejected.alphas.bar_alpha, 0xd0, 'the compiled default is kept');
  assert.equal(rejected.alphas.bar_bg_alpha, 0xd0);
  assert.equal(rejected.alphas.bar_sel_alpha, 0xd0);
  assert.equal(rejected.problems.length, 4);
});

test('optional and statusbar keys are collected while unvalidated keys are copied verbatim', () => {
  const result = parseAsDwm(
    paletteText({}, [
      'chip_bg=#1a2025',
      'tag_sel_bg=#1a2025',
      'tag_sel_fg=#a5acb3',
      'bar_bg_fg=#a5acb3',
      'stat_cpu=#a6cbe6',
      'weird_key=some_unknown_key',
    ]),
  );
  assert.equal(result.accepted, true);
  assert.equal(result.extras.chip_bg, '#1a2025');
  assert.equal(result.extras.stat_cpu, '#a6cbe6');
  // 未知键不被校验,原样进入 ignored(和 st_* 一样由 dwm 侧忽略/照抄)
  assert.ok(result.ignored.includes('weird_key') || result.extras.weird_key === 'some_unknown_key');
});

test('a 7-character non-colour passes dwm but is reported as suspicious', () => {
  const result = parseAsDwm(paletteText({ norm_fg: '#zzzzzz' }));
  assert.equal(result.accepted, true, "dwm checks length and the leading # only");
  assert.equal(result.suspicious.length, 1);
  assert.match(result.suspicious[0], /not a real #rrggbb/);
});

test('fgets() splits lines longer than 255 bytes, so a value cannot span the split', () => {
  const padding = 'x'.repeat(300);
  const result = parseAsDwm(`${paletteText()}#${padding}\n`);
  assert.equal(result.accepted, true);
  // The over-long comment line is cut in two; the second chunk has no '=' and
  // is skipped, exactly as dwm would see it.
  assert.equal(result.ignored.length, 0);
});

test('the caller-supplied defaults are used when an alpha is absent', () => {
  const result = parseAsDwm(paletteText(), { bar_alpha: 1, bar_bg_alpha: 2, bar_sel_alpha: 3 });
  assert.deepEqual(
    [result.alphas.bar_alpha, result.alphas.bar_bg_alpha, result.alphas.bar_sel_alpha],
    [1, 2, 3],
  );
  assert.deepEqual(
    [result.alphaSource.bar_alpha, result.alphaSource.bar_bg_alpha, result.alphaSource.bar_sel_alpha],
    ['default', 'default', 'default'],
  );
});

test('an empty file is rejected and reports every required key as missing', () => {
  const result = parseAsDwm('');
  assert.equal(result.accepted, false);
  assert.deepEqual(result.missingRequired, REQUIRED_KEYS);
});
