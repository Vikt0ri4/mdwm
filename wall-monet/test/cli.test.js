// End-to-end runs of bin/wall-monet in a fully isolated sandbox: temp HOME, temp
// cache, temp wallpaper dir, and stubbed feh/xprop recording their argv. No X
// server, no real feh, but the real ffmpeg and the real palette library.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseAsDwm } from '../src/dwm-parse.js';
import { KEY_ORDER } from '../src/palette.js';
import { ST_KEYS } from '../src/st-colors.js';
import { makeImage, makeSandbox, readStubLog, runCheckPalette, runCli, testEnv } from './helpers.js';

function seedWalls(sandbox, count = 2) {
  const specs = ['color=c=0x2e6b8a:s=64x64', 'gradients=s=64x64', 'testsrc2=s=64x64'];
  return Array.from({ length: count }, (_, i) =>
    makeImage(join(sandbox.wallDir, `wall-${i}.png`), specs[i % specs.length]),
  );
}

function paletteOf(sandbox) {
  return readFileSync(join(sandbox.cache, 'palette'), 'utf8');
}

function themeOf(sandbox) {
  return readFileSync(join(sandbox.cache, 'theme'), 'utf8').trim();
}

test('a bare run picks a wallpaper, sets it with feh, writes the palette and notifies dwm', () => {
  const sandbox = makeSandbox();
  const images = seedWalls(sandbox);
  const result = runCli([], { env: testEnv(sandbox) });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '', 'a bare run is silent on stdout');

  const text = paletteOf(sandbox);
  const parsed = parseAsDwm(text);
  assert.equal(parsed.accepted, true, 'dwm must accept what we wrote');
  assert.deepEqual(
    parsed.ignored.slice().sort(),
    ST_KEYS.slice().sort(),
    'dwm ignores the st_* keys that exist for the terminals',
  );
  assert.equal(themeOf(sandbox), 'dark', 'the first run defaults to dark');

  const chosen = text.match(/^# image=(.*)$/m)[1];
  assert.ok(images.includes(chosen), `${chosen} should be one of the wallpapers we planted`);

  const log = readStubLog(sandbox.logPath);
  assert.deepEqual(log[0], `--bg-fill ${chosen}`, 'feh must be asked to set exactly the image we analysed');
  assert.deepEqual(log[1], '-root -f _MONET_PALETTE 8s -set _MONET_PALETTE dark');
  assert.equal(log.length, 2);
});

test('check-palette accepts a freshly generated palette', () => {
  const sandbox = makeSandbox();
  seedWalls(sandbox, 1);
  assert.equal(runCli([], { env: testEnv(sandbox) }).status, 0);

  const checked = runCheckPalette([join(sandbox.cache, 'palette')]);
  assert.equal(checked.status, 0, checked.stdout);
  assert.match(checked.stdout, /dwm would ACCEPT this palette/);
});

test('--print writes nothing at all, not even the theme state', () => {
  const sandbox = makeSandbox();
  seedWalls(sandbox, 1);
  const result = runCli(['--print'], { env: testEnv(sandbox) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# wall-monet palette/);
  assert.match(result.stdout, /^norm_bg=#[0-9a-f]{6}$/m);
  assert.equal(existsSync(join(sandbox.cache, 'palette')), false);
  assert.equal(existsSync(join(sandbox.cache, 'theme')), false);
  assert.deepEqual(readStubLog(sandbox.logPath), [], 'nothing may be set or notified');
});

test('--print and a real run agree byte for byte apart from the timestamp', () => {
  const sandbox = makeSandbox();
  const [image] = seedWalls(sandbox, 1);

  const printed = runCli(['--print', '--dark', image], { env: testEnv(sandbox) });
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(runCli(['--no-set', '--dark', image], { env: testEnv(sandbox) }).status, 0);

  const strip = (text) => text.split('\n').filter((line) => !line.startsWith('# generated=')).join('\n');
  assert.equal(strip(printed.stdout), strip(paletteOf(sandbox)));
});

test('--toggle-theme flips the remembered theme without touching the wallpaper', () => {
  const sandbox = makeSandbox();
  const [image] = seedWalls(sandbox, 1);
  writeFileSync(join(sandbox.home, '.fehbg'), `feh --bg-fill '${image}'\n`);

  assert.equal(runCli(['--no-set'], { env: testEnv(sandbox) }).status, 0);
  assert.equal(themeOf(sandbox), 'dark');

  const toggled = runCli(['--toggle-theme'], { env: testEnv(sandbox) });
  assert.equal(toggled.status, 0, toggled.stderr);
  assert.equal(themeOf(sandbox), 'light');
  assert.match(paletteOf(sandbox), /^# theme=light$/m);
  assert.match(paletteOf(sandbox), new RegExp(`^# image=${image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));

  const back = runCli(['--toggle-theme'], { env: testEnv(sandbox) });
  assert.equal(back.status, 0, back.stderr);
  assert.equal(themeOf(sandbox), 'dark');

  const wallpaperCalls = readStubLog(sandbox.logPath).filter((line) => line.startsWith('--bg-fill'));
  assert.deepEqual(wallpaperCalls, [], 'toggling must never call feh: the wallpaper is not its business');
  assert.equal(readStubLog(sandbox.logPath).length, 3, 'only the three _MONET_PALETTE notifications');
});

test('--light and --dark force and remember the theme', () => {
  const sandbox = makeSandbox();
  const [image] = seedWalls(sandbox, 1);
  assert.equal(runCli(['--no-set', '--light', image], { env: testEnv(sandbox) }).status, 0);
  assert.equal(themeOf(sandbox), 'light');
  assert.match(paletteOf(sandbox), /^# theme=light$/m);

  assert.equal(runCli(['--no-set', '--dark', image], { env: testEnv(sandbox) }).status, 0);
  assert.equal(themeOf(sandbox), 'dark');
});

test('--current --no-set is the .xinitrc call: analyse what is set, change nothing', () => {
  const sandbox = makeSandbox();
  const [image] = seedWalls(sandbox, 1);
  writeFileSync(join(sandbox.home, '.fehbg'), `feh --bg-fill '${image}'\n`);

  const result = runCli(['--current', '--no-set'], { env: testEnv(sandbox) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(paletteOf(sandbox), new RegExp(`^# image=${image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.deepEqual(readStubLog(sandbox.logPath).length, 1, 'only the xprop notification, never feh');
  assert.match(readStubLog(sandbox.logPath)[0], /_MONET_PALETTE/);
});

test('--current explains itself when no wallpaper has been recorded', () => {
  const sandbox = makeSandbox();
  seedWalls(sandbox, 1);
  const result = runCli(['--current', '--no-set'], { env: testEnv(sandbox) });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.fehbg does not exist/);
  assert.equal(existsSync(join(sandbox.cache, 'palette')), false);
});

test('an explicit image path is set as the wallpaper and analysed', () => {
  const sandbox = makeSandbox();
  const [image] = seedWalls(sandbox, 1);
  const result = runCli([image], { env: testEnv(sandbox) });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readStubLog(sandbox.logPath)[0], `--bg-fill ${image}`);
  assert.match(paletteOf(sandbox), new RegExp(`^# image=${image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});

test('--no-set writes the palette without calling feh', () => {
  const sandbox = makeSandbox();
  const [image] = seedWalls(sandbox, 1);
  const result = runCli(['--no-set', image], { env: testEnv(sandbox) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(paletteOf(sandbox), /^norm_bg=/m);
  assert.deepEqual(readStubLog(sandbox.logPath).map((line) => line.split(' ')[0]), ['-root']);
});

test('an empty wallpaper directory is an error, and the previous palette survives it', () => {
  const sandbox = makeSandbox();
  mkdirSync(sandbox.wallDir, { recursive: true });
  const previous = 'norm_fg=#111111\n';
  writeFileSync(join(sandbox.cache, 'palette'), previous);

  const result = runCli([], { env: testEnv(sandbox) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no wallpapers found/);
  assert.equal(paletteOf(sandbox), previous, 'the old palette must be left untouched');
  assert.deepEqual(readStubLog(sandbox.logPath), []);
});

test('without DISPLAY the palette is still written and the failure is only reported', () => {
  const sandbox = makeSandbox();
  seedWalls(sandbox, 1);
  const result = runCli(['--verbose'], { env: testEnv({ ...sandbox, display: null }) });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseAsDwm(paletteOf(sandbox)).accepted, true);
  assert.deepEqual(readStubLog(sandbox.logPath).length, 1, 'feh still runs, xprop does not');
  assert.match(result.stderr, /DISPLAY is not set/);
});

test('--verbose explains the colour decisions on stderr without polluting stdout', () => {
  const sandbox = makeSandbox();
  seedWalls(sandbox, 1);
  const result = runCli(['--print', '--verbose'], { env: testEnv(sandbox) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /wallpaper left alone/);
  assert.match(result.stderr, /contrastLevel/);
  assert.match(result.stdout, /^# wall-monet palette/);
  assert.doesNotMatch(result.stdout, /wall-monet:/, 'diagnostics must never land in the palette');
});

test('MONET_CACHE_DIR is honoured, exactly as dwm and statusbar.sh honour it', () => {
  const sandbox = makeSandbox();
  seedWalls(sandbox, 1);
  const elsewhere = join(sandbox.root, 'other-cache');
  const env = { ...testEnv(sandbox), MONET_CACHE_DIR: elsewhere };

  assert.equal(runCli(['--no-set'], { env }).status, 0);
  assert.equal(existsSync(join(elsewhere, 'palette')), true);
  assert.equal(existsSync(join(sandbox.cache, 'palette')), false);
});

test('MONET_WALL_DIR is honoured for the random-pick mode', () => {
  const sandbox = makeSandbox();
  const custom = join(sandbox.root, 'custom-walls');
  mkdirSync(custom, { recursive: true });
  const image = makeImage(join(custom, 'only.png'), 'color=c=0x884422:s=32x32');

  const result = runCli(['--no-set'], { env: testEnv({ ...sandbox, wallDir: custom }) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(paletteOf(sandbox), new RegExp(`^# image=${image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});

test('usage errors exit 2, and --help exits 0', () => {
  const sandbox = makeSandbox();
  const bad = runCli(['--nonsense'], { env: testEnv(sandbox) });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option: --nonsense/);
  assert.match(bad.stderr, /usage: wall-monet/);

  const twoImages = runCli(['a.png', 'b.png'], { env: testEnv(sandbox) });
  assert.equal(twoImages.status, 2);
  assert.match(twoImages.stderr, /more than one image/);

  const help = runCli(['--help'], { env: testEnv(sandbox) });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: wall-monet/);
  assert.match(help.stdout, /MONET_CACHE_DIR/);
});

test('the generated palette carries every key the contract promises', () => {
  const sandbox = makeSandbox();
  const [image] = seedWalls(sandbox, 1);
  assert.equal(runCli(['--no-set', image], { env: testEnv(sandbox) }).status, 0);

  const parsed = parseAsDwm(paletteOf(sandbox));
  assert.deepEqual(parsed.missingRequired, []);
  for (const key of KEY_ORDER) {
    if (ST_KEYS.includes(key)) continue;
    assert.ok(parsed.colors[key] ?? parsed.extras[key], `${key} must be present`);
  }
  assert.deepEqual(parsed.ignored.slice().sort(), ST_KEYS.slice().sort());
});
