// A faithful port of parsepalette() in the monet-patched dwm.c (see
// /home/kjrin/dwm/dwm.c, "monet: Material 3 Expressive 调色板"). This exists so
// that the offline test suite can answer the only question that really matters:
// "would dwm accept this file?" -- and so that bin/check-palette can answer it
// for a file already on disk.
//
// Every quirk below is intentional; each one is a way to get the whole file
// silently rejected:
//   * a line only counts as a comment if '#' is its FIRST character
//   * the key is everything before the FIRST '='; the value is everything after
//   * neither side is trimmed -- "norm_fg = #aabbcc" yields the key "norm_fg "
//   * an embedded \r or \n truncates the value (fgets + an explicit scan)
//   * a required colour must be exactly 7 chars starting with '#'
//   * a required colour that fails validation is simply "not found", and dwm
//     discards the entire file unless all six were found
//   * the bar_alpha family must be a pure integer 0..255, else the compiled
//     default is kept (which does NOT invalidate the file)
//   * chip_bg/tag_sel_bg/tag_sel_fg/bar_bg_fg get the same 7-char check but are
//     otherwise ignored
//   * tag_hl_bg/tag_hl_fg/tag_urg_bg/tag_urg_fg are copied with NO validation
//   * fgets() reads at most 255 bytes at a time, so a longer line arrives as
//     two independent "lines"
export const REQUIRED_KEYS = [
  'norm_fg',
  'norm_bg',
  'norm_border',
  'sel_fg',
  'sel_bg',
  'sel_border',
];

export const ALPHA_KEYS = ['bar_alpha', 'bar_bg_alpha', 'bar_sel_alpha'];

/** Validated as `#rrggbb` but only meaningful to some dwm builds. */
export const HEX_OPTIONAL_KEYS = ['chip_bg', 'tag_sel_bg', 'tag_sel_fg', 'tag_hl_bg', 'tag_hl_fg', 'tag_urg_bg', 'tag_urg_fg', 'bar_bg_fg', 'tray_bg'];

/** Copied verbatim by dwm; never length- or format-checked. */
export const UNVALIDATED_KEYS = ['tag_hl_bg', 'tag_hl_fg', 'tag_urg_bg', 'tag_urg_fg'];

/** Keys read by the surviving ${HOME}/.config/dwm/statusbar.sh. */
export const STATUSBAR_KEYS = [
  'stat_cpu',
  'stat_mem',
  'stat_disk',
  'stat_net',
  'stat_vol',
  'stat_time',
];

export const KNOWN_KEYS = [
  ...REQUIRED_KEYS,
  ...ALPHA_KEYS,
  ...HEX_OPTIONAL_KEYS,
  ...UNVALIDATED_KEYS,
  ...STATUSBAR_KEYS,
];

const FGETS_MAX = 255;

/**
 * Split input the way fgets(line, 256, fp) would: at most 255 bytes per call,
 * stopping after a newline when one is seen earlier.
 */
function fgetsChunks(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf('\n', start);
    const limit = Math.min(start + FGETS_MAX, text.length);
    if (nl !== -1 && nl < limit) {
      chunks.push(text.slice(start, nl + 1)); // includes the '\n'
      start = nl + 1;
    } else {
      chunks.push(text.slice(start, limit));
      start = limit;
    }
  }
  return chunks;
}

function isHex7(value) {
  return value.length === 7 && value[0] === '#';
}

/** dwm's check for a real colour, stricter than its own parser. */
function isRealHex(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Emulate `strtol(val, &end, 10)` plus the `!*end` test dwm performs. Notably
 * this means leading whitespace is skipped and a leading '+' is allowed, so
 * " 16" IS accepted while "16 " is not. Getting this wrong in either direction
 * would make check-palette lie about the file.
 */
function strtolBase10(value) {
  let i = 0;
  while (i < value.length && /[ \t\v\f]/.test(value[i])) i++;
  let sign = 1;
  if (value[i] === '+' || value[i] === '-') {
    if (value[i] === '-') sign = -1;
    i++;
  }
  const start = i;
  while (i < value.length && value[i] >= '0' && value[i] <= '9') i++;
  if (i === start) return null; // no digits consumed at all
  if (i !== value.length) return null; // trailing junk
  const n = sign * Number(value.slice(start, i));
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * @param {string} text palette file contents
 * @param {object} [defaults] compiled-in fallbacks dwm keeps when a key is
 *   absent or invalid, i.e. baralpha/barbgalpha/barselalpha in config.h
 * @returns {{
 *   accepted: boolean, foundRequired: string[], missingRequired: string[],
 *   colors: Record<string,string>, alphas: Record<string,number>,
 *   extras: Record<string,string>, ignored: string[], problems: string[],
 *   suspicious: string[], alphaSource: Record<string,'file'|'default'>
 * }}
 */
export function parseAsDwm(text, defaults = { bar_alpha: 0xd0, bar_bg_alpha: 0xd0, bar_sel_alpha: 0xd0 }) {
  const colors = {};
  const alphas = { ...defaults };
  const alphaSource = {};
  for (const k of ALPHA_KEYS) alphaSource[k] = 'default';
  const extras = {};
  const ignored = [];
  const problems = [];
  const suspicious = [];

  for (const raw of fgetsChunks(String(text))) {
    if (raw === '') continue;
    if (raw[0] === '#') continue; // comment: first character only
    const eq = raw.indexOf('=');
    if (eq === -1) continue;

    const key = raw.slice(0, eq);
    let value = raw.slice(eq + 1);
    // dwm truncates the value at the first \n or \r it meets.
    const cut = value.search(/[\n\r]/);
    if (cut !== -1) value = value.slice(0, cut);

    if (ALPHA_KEYS.includes(key)) {
      const n = strtolBase10(value);
      if (n !== null && n >= 0 && n <= 255) {
        alphas[key] = n;
        alphaSource[key] = 'file';
      } else {
        problems.push(`${key}: ${JSON.stringify(value)} is not an integer 0-255, keeping the compiled default`);
      }
      continue;
    }

    if (REQUIRED_KEYS.includes(key) || HEX_OPTIONAL_KEYS.includes(key) || STATUSBAR_KEYS.includes(key)) {
      if (isHex7(value)) {
        // dwm only checks the length and the leading '#', so "#zzzzzz" gets
        // through its parser and only explodes later inside XParseColor.
        if (!isRealHex(value)) suspicious.push(`${key}: ${JSON.stringify(value)} passes dwm's parser but is not a real #rrggbb colour`);
        if (REQUIRED_KEYS.includes(key)) colors[key] = value;
        else extras[key] = value;
      } else {
        problems.push(`${key}: ${JSON.stringify(value)} is not #rrggbb, ignored`);
      }
      continue;
    }

    if (UNVALIDATED_KEYS.includes(key)) {
      extras[key] = value; // no validation whatsoever, by design
      continue;
    }

    ignored.push(key);
  }

  const foundRequired = REQUIRED_KEYS.filter((k) => k in colors);
  const missingRequired = REQUIRED_KEYS.filter((k) => !(k in colors));

  return {
    accepted: missingRequired.length === 0,
    foundRequired,
    missingRequired,
    colors,
    alphas,
    extras,
    ignored,
    problems,
    suspicious,
    alphaSource,
  };
}
