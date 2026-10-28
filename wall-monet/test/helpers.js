// Shared test scaffolding. Everything runs without an X server: feh and xprop
// are stubbed on PATH, ffmpeg is genuinely used for fixtures, and both the cache
// directory and the wallpaper directory are redirected into a throwaway temp dir.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const cliPath = join(repoRoot, 'bin', 'wall-monet');
export const checkPalettePath = join(repoRoot, 'bin', 'check-palette');

export function makeTmpDir(prefix = 'wall-monet-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Build a deterministic image from ffmpeg's own lavfi sources. */
export function makeImage(path, spec = 'color=c=0x2e6b8a:s=64x64') {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', spec, '-frames:v', '1', path], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`ffmpeg could not build the fixture ${spec}: ${result.stderr}`);
  return path;
}

/**
 * Install a fake feh/xprop on PATH that appends its argv to a log file, so tests
 * can assert what wall-monet tried to run without any X server.
 */
export function writeStub(dir, name, logPath) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nexit 0\n`, { mode: 0o755 });
  return path;
}

/** Lines the stubs recorded, oldest first. */
export function readStubLog(logPath) {
  try {
    return readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

/** A ready-to-use sandbox: home, cache, wallpaper dir and stubs all isolated. */
export function makeSandbox() {
  const root = makeTmpDir();
  const home = join(root, 'home');
  const cache = join(root, 'cache');
  const wallDir = join(root, 'walls');
  const stubDir = join(root, 'stubs');
  const logPath = join(root, 'stub.log');
  for (const dir of [home, cache, wallDir, stubDir]) mkdirSync(dir, { recursive: true });
  writeStub(stubDir, 'feh', logPath);
  writeStub(stubDir, 'xprop', logPath);
  return { root, home, cache, wallDir, stubDir, logPath };
}

/** A complete, isolated environment for one CLI run. */
export function testEnv({ home, cache, wallDir, stubDir, display = ':99' } = {}) {
  const env = { ...process.env, HOME: home, PATH: `${stubDir}:${process.env.PATH ?? ''}` };
  if (cache) env.MONET_CACHE_DIR = cache;
  if (wallDir) env.MONET_WALL_DIR = wallDir;
  if (display === null) delete env.DISPLAY;
  else env.DISPLAY = display;
  return env;
}

export function runCli(args, { env } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', env });
}

export function runCheckPalette(args, { input } = {}) {
  return spawnSync(process.execPath, [checkPalettePath, ...args], { encoding: 'utf8', input });
}
