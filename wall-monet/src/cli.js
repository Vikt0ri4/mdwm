// Command-line front end.
//
// The flag set is not invented: `--current`, `--no-set` and `--toggle-theme`
// are proven by the surviving .xinitrc and config.h of the monet-patched dwm,
// and MONET_CACHE_DIR is honoured by both dwm and statusbar.sh. Everything else
// here is additive, for debugging and for headless verification.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cacheDir, logPath, palettePath, wallpaperDir } from './paths.js';
import { decodeImageToRgba } from './decode.js';
import { seedFromRgba, blurredBarBackdrops } from './seed.js';
import { ALPHA_DEFAULTS, CONTRAST_MIN, choosePalette } from './scheme.js';
import { DEFAULT_ALPHA, DEFAULT_THEME, flipTheme, readTheme, renderPalette, writeAtomic, writeTheme } from './palette.js';
import { notifyDwm } from './notify.js';
import { applyWallpaper, currentWallpaper, listWallpapers, pickRandom } from './wallpaper.js';
import { createLogger } from './log.js';

class UsageError extends Error {}

/** bin/monet-apply, resolved relative to this file so it works installed too. */
const MONET_APPLY = fileURLToPath(new URL('../bin/monet-apply', import.meta.url));

/**
 * Retint every running st. A failure here must not fail the run: the palette is
 * already committed and dwm has already reloaded, so "no st is open" or a read-only
 * pty is a warning, not an error.
 */
function applyStTheme(env, log, { spawn = spawnSync } = {}) {
  const result = spawn(process.execPath, [MONET_APPLY], { encoding: 'utf8', env });
  if (result.error) {
    log.warn(`could not run monet-apply: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    const detail = result.stderr ? String(result.stderr).trim() : `exit ${result.status}`;
    log.warn(`monet-apply could not retint the terminals: ${detail}`);
    return false;
  }
  if (result.stdout && result.stdout.trim() !== '') log.info(result.stdout.trim());
  return true;
}

export const USAGE = `usage: wall-monet [options] [image]

Generate a Material 3 Expressive (2025 spec) palette from a wallpaper and hand it
to a monet-patched dwm via \${MONET_CACHE_DIR:-$HOME/.cache/monet}/palette.

image source
  (no argument)        pick a random image from $MONET_WALL_DIR
                       (default: ~/图片) and set it as the wallpaper
  [image]              analyse this image
  --current            analyse the wallpaper currently set, per ~/.fehbg

what to do with it
  --no-set             do not change the wallpaper
  --toggle-theme       re-analyse the current wallpaper, swapping dark/light
  --light, --dark      force the theme for this run and remember it
  --print              write the palette to stdout; change nothing on disk
  --verbose            log to stderr and to $CACHE/wall-monet.log
  -h, --help           show this help

environment
  MONET_CACHE_DIR      where palette/theme/log live (default ~/.cache/monet)
  MONET_WALL_DIR       wallpaper directory for the no-argument mode
  DISPLAY              required to notify dwm; without it the palette is still
                       written and dwm picks it up next time it starts
`;

export function parseArgs(argv) {
  const options = {
    image: null,
    current: false,
    noSet: false,
    toggle: false,
    theme: null,
    print: false,
    verbose: false,
    help: false,
  };
  for (const arg of argv) {
    switch (arg) {
      case '--current': options.current = true; break;
      case '--no-set': options.noSet = true; break;
      case '--toggle-theme': options.toggle = true; break;
      case '--light': options.theme = 'light'; break;
      case '--dark': options.theme = 'dark'; break;
      case '--print': options.print = true; break;
      case '--verbose': options.verbose = true; break;
      case '-h':
      case '--help': options.help = true; break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`unknown option: ${arg}`);
        if (options.image !== null) throw new UsageError(`more than one image given: ${options.image} and ${arg}`);
        options.image = arg;
    }
  }
  return options;
}

/**
 * @returns {Promise<number>} process exit code
 */
export async function main(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr.write(`wall-monet: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    stdout.write(USAGE);
    return 0;
  }

  const cache = cacheDir(env);
  const log = createLogger({ verbose: options.verbose, file: logPath(env), stderr });

  try {
    // 1. Theme. --toggle-theme flips the remembered state; --light/--dark force
    //    and remember; otherwise reuse what is remembered, defaulting to dark.
    const remembered = readTheme(cache) ?? DEFAULT_THEME;
    let theme;
    if (options.theme) theme = options.theme;
    else if (options.toggle) theme = flipTheme(remembered);
    else theme = remembered;

    // 2. Which image. --toggle-theme must not disturb the wallpaper, so it reads
    //    the current one exactly like --current does.
    let image;
    let origin;
    if (options.image !== null) {
      image = resolve(options.image);
      origin = 'argument';
    } else if (options.current || options.toggle) {
      image = currentWallpaper(env);
      origin = 'fehbg';
    } else {
      const dir = wallpaperDir(env);
      const candidates = listWallpapers(dir);
      if (candidates.length === 0) throw new Error(`no wallpapers found in ${dir}`);
      image = pickRandom(candidates);
      origin = 'random';
    }

    // 3. Apply it, unless asked not to. --print must be side-effect free, and a
    //    theme toggle is not allowed to change the wallpaper.
    const shouldSet = !options.noSet && !options.print && !options.toggle;
    if (shouldSet) {
      applyWallpaper(image, { env });
      log.info(`wallpaper set: ${image}`);
    } else {
      log.info(`wallpaper left alone: ${image}`);
    }

    // 4. pixels -> seed -> palette
    const { pixels, pixelCount, width, height } = decodeImageToRgba(image, { env });
    const seed = seedFromRgba(pixels);
    // The bar is translucent, so text sits on norm_bg @ bar_bg_alpha over the
    // wallpaper: hand the real wallpaper pixels in and let the contrast check
    // take the worst case over all of them.
    // Only the wallpaper strip that can actually sit behind the bar matters, and
    // picom blurs that strip before text is drawn on it -- see blurredBarBackdrops.
    // MONET_BAR_BAND widens the strip for wallpapers that feh crops top+bottom.
    const band = Number(env.MONET_BAR_BAND ?? 0.05);
    // A full-screen terminal sits over the whole image, so its pre-compensation needs the
    // image average rather than the top strip.
    let sum = [0, 0, 0];
    const count = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      sum[0] += pixels[i];
      sum[1] += pixels[i + 1];
      sum[2] += pixels[i + 2];
    }
    const wallpaperMean = `#${sum
      .map((v) => Math.round(v / count).toString(16).padStart(2, '0'))
      .join('')}`;
    const backdrops = blurredBarBackdrops(pixels, {
      width,
      height,
      band: Number.isFinite(band) && band > 0 && band <= 1 ? band : 0.05,
      // 1 bucket: with a strong blur (strength 7) the bar's backdrop is the strip's
      // *mean*, so that is what the text is checked against. Reducing the blur makes
      // the real backdrop more varied than this model assumes.
      cells: 1,
    });
    const chosen = choosePalette(seed.argb, theme === 'dark', {
      backdrops,
      wallpaperMean,
      barAlpha: DEFAULT_ALPHA.bar_bg_alpha,
    });

    // Logged before any early return, so that `--print --verbose` explains the
    // colour decisions too.
    log.info(
      `colour decisions: origin=${origin}, theme=${theme}, seed=${seed.hex}, ` +
        `barAlpha=0x${DEFAULT_ALPHA.bar_bg_alpha.toString(16)}, backdrops=${backdrops.length}, ` +
        `contrastLevel=${chosen.level}, lowest pair ${chosen.minRatio.toFixed(2)}:1`,
    );

    if (chosen.escalated) {
      log.info(
        `raised contrastLevel to ${chosen.level} to clear WCAG ${CONTRAST_MIN}:1 on every rendered pair`,
      );
    }
    if (chosen.shortfall) {
      // Only pairs that are actually drawn decide this; advisory ones (stat_*, and the
      // base colour on a chip) would otherwise name a combination the bar never shows.
      const drawn = chosen.report.filter((r) => !r.advisory);
      const worst = drawn.reduce((a, b) => (b.ratio < a.ratio ? b : a));
      log.warn(
        `lowest contrast is still ${worst.ratio.toFixed(2)}:1 (${worst.what}) at contrastLevel ${chosen.level}; ` +
          `${CONTRAST_MIN}:1 not reachable for this wallpaper at barAlpha=0x${DEFAULT_ALPHA.bar_alpha.toString(16)} -- ` +
          'try the other theme (Super+Shift+D) or raise the alpha',
      );
    }

    const text = renderPalette({
      image,
      theme,
      seed: seed.hex,
      generated: new Date().toISOString(),
      values: chosen.values,
      alpha: ALPHA_DEFAULTS,
    });

    // 5. --print stops here: nothing written, nobody notified.
    if (options.print) {
      stdout.write(text);
      return 0;
    }

    // 6. Commit. The palette lands first and atomically, so a crash anywhere
    //    before this point leaves the previous palette intact.
    writeAtomic(palettePath(env), text);
    writeTheme(cache, theme);

    const notified = notifyDwm(theme, env);
    if (notified.skipped) log.info(notified.reason);
    else if (!notified.ok) log.warn(`could not tell dwm to reload: ${notified.reason}`);

    // 7. Push the palette into the running terminals. dwm needed the xprop above,
    //    statusbar.sh re-reads the palette every second and dmenu_palette reads it
    //    when it is invoked -- st is the only consumer that has to be told.
    applyStTheme(env, log);

    log.info(
      `done: ${origin} image, theme=${theme}, seed=${seed.hex}, contrastLevel=${chosen.level}, ` +
        `${pixelCount} sampled pixels -> ${palettePath(env)}`,
    );
    return 0;
  } catch (error) {
    log.error(error.message);
    return 1;
  }
}
