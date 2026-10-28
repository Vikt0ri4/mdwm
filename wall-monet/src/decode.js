// Image -> raw pixels. We shell out to ffmpeg rather than depend on a native
// image decoder: ffmpeg is already installed on the target machine, it reads
// every format worth reading, and it keeps wall-monet's own dependency set to a
// single pure-JS package. (The original wall-monet did the same -- the backup
// .xinitrc says "取色会 fork ffmpeg/node".)
import { spawnSync } from 'node:child_process';

export const DEFAULT_MAX_EDGE = 128;

/**
 * Decode the first frame of `file` to opaque RGBA, downscaled to fit a
 * maxEdge x maxEdge box.
 *
 * Opaque matters: material-color-utilities' sourceColorFromImageBytes() drops
 * every pixel whose alpha is < 255, so feeding it straight rgb24 (which has no
 * alpha channel at all) sidesteps that trap entirely.
 *
 * @returns {{ pixels: Uint8ClampedArray, pixelCount: number, width: number, height: number }}
 */
export function decodeImageToRgba(file, { maxEdge = DEFAULT_MAX_EDGE, ffmpeg = 'ffmpeg', spawn = spawnSync, env = process.env } = {}) {
  if (!Number.isInteger(maxEdge) || maxEdge < 1) throw new Error(`maxEdge must be a positive integer, got ${maxEdge}`);
  const args = [
    '-hide_banner', '-loglevel', 'info',
    '-i', file,
    '-frames:v', '1',
    // Never upscale a small image: keep at most maxEdge on each side.
    // showinfo lets us learn the sampled geometry (it is logged at info level), which
    // is what makes it possible to look only at the wallpaper strip behind the bar.
    '-vf', `scale='min(${maxEdge},iw)':'min(${maxEdge},ih)':force_original_aspect_ratio=decrease,showinfo`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ];
  const res = spawn(ffmpeg, args, { maxBuffer: 256 * 1024 * 1024, env });
  if (res.error) throw new Error(`could not run ${ffmpeg}: ${res.error.message}`);
  const stderr = res.stderr ? String(res.stderr).trim() : '';
  if (res.status !== 0) throw new Error(`${ffmpeg} failed on ${file} (exit ${res.status})${stderr ? `: ${stderr}` : ''}`);
  const rgb = res.stdout;
  if (!rgb || rgb.length === 0) throw new Error(`${ffmpeg} produced no pixels for ${file}${stderr ? `: ${stderr}` : ''}`);
  if (rgb.length % 3 !== 0) throw new Error(`${ffmpeg} produced a truncated frame for ${file} (${rgb.length} bytes)`);

  const pixelCount = rgb.length / 3;
  // showinfo prints "s:WxH"; take the last occurrence (one frame, but be safe).
  const sizes = [...String(res.stderr ?? '').matchAll(/s:(\d+)x(\d+)/g)];
  const last = sizes.at(-1);
  const width = last ? Number(last[1]) : pixelCount;
  const height = last ? Number(last[2]) : 1;
  const pixels = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    pixels[i * 4] = rgb[i * 3];
    pixels[i * 4 + 1] = rgb[i * 3 + 1];
    pixels[i * 4 + 2] = rgb[i * 3 + 2];
    pixels[i * 4 + 3] = 255;
  }
  return { pixels, pixelCount, width, height };
}
