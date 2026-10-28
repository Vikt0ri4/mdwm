// Colour maths that has to agree with dwm's C, plus the WCAG check that the
// readability guarantee rests on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argbToHex, blendHex, contrastRatio, hexToRgb, isHex6, relativeLuminance } from '../src/color.js';

test('argbToHex drops the alpha channel and lowercases', () => {
  assert.equal(argbToHex(0xff2e6b8a), '#2e6b8a');
  assert.equal(argbToHex(0x00000000), '#000000');
  assert.equal(argbToHex(0xffffffff), '#ffffff');
});

test('hexToRgb round-trips and rejects anything dwm would not give us', () => {
  assert.deepEqual(hexToRgb('#2e6b8a'), { r: 0x2e, g: 0x6b, b: 0x8a });
  for (const bad of ['2e6b8a', '#2e6b8', '#2e6b8aa', '#zzzzzz']) {
    assert.throws(() => hexToRgb(bad), /not a #rrggbb color/);
  }
});

test('isHex6 accepts exactly the 7-character form', () => {
  assert.equal(isHex6('#aabbcc'), true);
  assert.equal(isHex6('#AABBCC'), true);
  assert.equal(isHex6('#aabbc'), false);
  assert.equal(isHex6('#aabbccd'), false);
  assert.equal(isHex6(undefined), false);
});

test('blendHex matches dwm blendhex() integer arithmetic exactly', () => {
  // dwm: (a * alpha + b * (255 - alpha)) / 255, with C truncating division.
  assert.equal(blendHex('#ffffff', '#000000', 128), '#808080');
  assert.equal(blendHex('#000000', '#ffffff', 128), '#7f7f7f');
  assert.equal(blendHex('#ffffff', '#000000', 0), '#000000');
  assert.equal(blendHex('#ffffff', '#000000', 255), '#ffffff');
  // The chip alpha dwm uses for tagclr, worked by hand:
  //   r: (0x83*217 + 0x0b*38) / 255 = 28845/255 = 113 = 0x71
  //   g: (0xa8*217 + 0x0f*38) / 255 = 37026/255 = 145 = 0x91
  //   b: (0xc2*217 + 0x11*38) / 255 = 42744/255 = 167 = 0xa7
  assert.equal(blendHex('#83a8c2', '#0b0f11', 0xd9), '#7191a7');
});

test('blendHex refuses a non-byte alpha', () => {
  assert.throws(() => blendHex('#ffffff', '#000000', 128.5), /integer 0..255/);
  assert.throws(() => blendHex('#ffffff', '#000000', 256), /integer 0..255/);
});

test('WCAG contrast ratio matches the reference values', () => {
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrastRatio('#ffffff', '#ffffff').toFixed(2), '1.00');
  assert.equal(contrastRatio('#ffffff', '#000000').toFixed(2), '21.00', 'order independent');
  // 4.5:1 is the threshold we enforce; sanity-check a known pair.
  assert.ok(contrastRatio('#767676', '#ffffff') > 4.5);
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.6);
});

test('relative luminance is monotonic in brightness', () => {
  assert.ok(relativeLuminance('#000000') < relativeLuminance('#808080'));
  assert.ok(relativeLuminance('#808080') < relativeLuminance('#ffffff'));
});
