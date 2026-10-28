// Rendering and writing of the palette file, plus the single-line theme state.
//
// The write is always atomic (write a sibling temp file, then rename) because
// dwm re-reads the palette from a PropertyNotify handler: a partially written
// file is not a theoretical hazard, and a half-written file is rejected
// wholesale (see dwm-parse.js), which would leave the bar showing stale colours
// with no error anywhere the user can see.
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isHex6 } from './color.js';
import { REQUIRED_KEYS } from './dwm-parse.js';
import { ST_KEYS } from './st-colors.js';

/** Emission order. dwm does not care, humans diffing two palettes do. */
export const KEY_ORDER = [
  ...REQUIRED_KEYS,
  'tag_sel_bg',
  'tag_sel_fg',
  'tag_hl_bg',
  'tag_hl_fg',
  'tag_urg_bg',
  'tag_urg_fg',
  'tray_bg',
  ...ST_KEYS,
];

/**
 * The bar alpha the contrast model assumes. dwm's BAR_ALPHA in config.h is the
 * source of truth (0x40); the palette no longer emits the old bar_*_alpha keys.
 */
export const DEFAULT_ALPHA = { bar_alpha: 0x40, bar_bg_alpha: 0x40, bar_sel_alpha: 0x40 };

export const DEFAULT_THEME = 'dark';
export const THEMES = ['dark', 'light'];

/** Throw if we are about to emit anything dwm would reject outright. */
export function validatePalette(values) {
  for (const key of KEY_ORDER) {
    const value = values[key];
    if (!isHex6(value)) {
      throw new Error(`refusing to write ${key}=${JSON.stringify(value)}: dwm requires #rrggbb`);
    }
  }
  return true;
}

/**
 * Read a palette file the way our own consumers need it: a flat key -> value
 * map, comment lines skipped. This is deliberately NOT parseAsDwm() -- that one
 * reimplements dwm's quirks, while this one trusts what we ourselves wrote.
 */
export function readPaletteValues(path) {
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    values[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return values;
}

/** A newline in a header value would corrupt the line-oriented format. */
function oneLine(text) {
  return String(text).replace(/[\r\n]+/g, ' ');
}

/**
 * Render the palette. `--print` emits exactly this string, byte for byte, so
 * `wall-monet --print | diff - ~/.cache/monet/palette` is a meaningful check.
 */
export function renderPalette({ image, theme, seed, generated, values }) {
  validatePalette(values);
  const lines = [
    '# wall-monet palette -- generated file, safe to delete',
    `# image=${oneLine(image)}`,
    `# theme=${oneLine(theme)}`,
    `# seed=${oneLine(seed)}`,
    `# generated=${oneLine(generated)}`,
  ];
  for (const key of KEY_ORDER) {
    lines.push(`${key}=${values[key]}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Write `text` to `path` atomically, creating the directory if needed. */
export function writeAtomic(path, text) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    // Explicit mode: the target directory is a cache dir that may have a
    // restrictive umask, and statusbar.sh (same user) must be able to read it.
    writeFileSync(tmp, text, { mode: 0o644 });
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // The temp file may never have been created; nothing to clean up.
    }
    throw error;
  }
  return path;
}

/** @returns {'dark'|'light'|null} null when absent, unreadable or unrecognised. */
export function readTheme(dir) {
  try {
    const value = readFileSync(join(dir, 'theme'), 'utf8').trim();
    return THEMES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeTheme(dir, theme) {
  if (!THEMES.includes(theme)) throw new Error(`unknown theme ${JSON.stringify(theme)}`);
  return writeAtomic(join(dir, 'theme'), `${theme}\n`);
}

export function flipTheme(theme) {
  return theme === 'dark' ? 'light' : 'dark';
}
