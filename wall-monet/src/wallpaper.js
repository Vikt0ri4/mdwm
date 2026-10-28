// Wallpaper discovery and setting.
//
// ~/.fehbg is the source of truth for "the current wallpaper": feh writes it
// automatically on every --bg-fill, so it is a real record rather than a cache
// we would have to keep in sync. (The X root pixmap would be more authoritative
// but needs a compositor-set property and a screen grab, and grabbing the root
// window would capture whatever windows happen to be open.)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fehbgPath } from './paths.js';

export const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|bmp|gif|avif|tiff?|jxl)$/i;

/** Minimal POSIX-ish tokenizer: enough for the single command line feh writes. */
export function tokenize(line) {
  const out = [];
  let current = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && i + 1 < line.length) current += line[++i];
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === ' ' || char === '\t') {
      if (started) {
        out.push(current);
        current = '';
        started = false;
      }
    } else if (char === '\\' && i + 1 < line.length) {
      current += line[++i];
      started = true;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) out.push(current);
  return out;
}

/**
 * Pull the wallpaper path out of feh's generated ~/.fehbg script.
 * @returns {string|null}
 */
export function parseFehbg(text) {
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const candidates = tokenize(line).filter(
      (token) => !token.startsWith('-') && token !== 'exec' && token !== '&' && token !== ';',
    );
    const images = candidates.filter((token) => IMAGE_EXTENSIONS.test(token));
    if (images.length > 0) return images[images.length - 1];
  }
  return null;
}

export function currentWallpaper(env = process.env) {
  const path = fehbgPath(env);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot tell which wallpaper is set: ${path} does not exist (run wall-monet with an image path, or set one with feh first)`);
  }
  const image = parseFehbg(text);
  if (!image) throw new Error(`cannot tell which wallpaper is set: no image path found in ${path}`);
  return image;
}

/** Sorted absolute paths of candidate wallpapers in `dir`. */
export function listWallpapers(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`cannot read the wallpaper directory ${dir}`);
  }
  return entries
    .filter((name) => IMAGE_EXTENSIONS.test(name))
    .map((name) => join(dir, name))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

export function pickRandom(list, rng = Math.random) {
  if (!list || list.length === 0) throw new Error('no wallpaper to pick from');
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  return list[index];
}

/** Apply the wallpaper. feh rewrites ~/.fehbg as a side effect, which is what
 *  makes `--current` work on the next run. */
export function applyWallpaper(image, { feh = 'feh', spawn = spawnSync, env = process.env } = {}) {
  const result = spawn(feh, ['--bg-fill', resolve(image)], { encoding: 'utf8', env });
  if (result.error) throw new Error(`could not run ${feh}: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr).trim() : '';
    throw new Error(`${feh} failed to set ${image} (exit ${result.status})${stderr ? `: ${stderr}` : ''}`);
  }
  return image;
}
