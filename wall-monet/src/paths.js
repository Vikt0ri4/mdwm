// Filesystem contract, mirrored from the monet-patched dwm and from the
// surviving statusbar.sh: both resolve the palette as
// `${MONET_CACHE_DIR:-$HOME/.cache/monet}/palette`. Note that dwm does NOT
// consult XDG_CACHE_HOME, and neither do we.
import { homedir } from 'node:os';
import { join } from 'node:path';

export function homeDir(env = process.env) {
  return env.HOME && env.HOME !== '' ? env.HOME : homedir();
}

/** Directory holding palette, theme state and our own log. */
export function cacheDir(env = process.env) {
  const override = env.MONET_CACHE_DIR;
  if (override && override !== '') return override;
  return join(homeDir(env), '.cache', 'monet');
}

export function palettePath(env = process.env) {
  return join(cacheDir(env), 'palette');
}

/** Single-line `dark` / `light` state file. */
export function themePath(env = process.env) {
  return join(cacheDir(env), 'theme');
}

export function logPath(env = process.env) {
  return join(cacheDir(env), 'wall-monet.log');
}

/** Wallpaper directory for the no-argument "pick one at random" mode. */
export function wallpaperDir(env = process.env) {
  const override = env.MONET_WALL_DIR;
  if (override && override !== '') return override;
  return join(homeDir(env), '图片');
}

/** feh writes this shell script; it is our source of truth for `--current`. */
export function fehbgPath(env = process.env) {
  return join(homeDir(env), '.fehbg');
}
