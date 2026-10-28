// The consumers that read the palette: monet-apply (pushes colours into st),
// dmenu_palette (the rebuilt dmenu wrapper) and the shell startup snippet.
//
// Everything here is exercised through the real executables: the bins have no
// file extension, so importing them would need Node's format detection, and
// spawning them is closer to how they are actually used anyway.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { findStTtys } from '../src/st-terminals.js';
import { readPaletteValues } from '../src/palette.js';
import { oscSequences } from '../src/st-colors.js';
import { makeImage, makeSandbox, makeTmpDir, repoRoot, runCli, testEnv } from './helpers.js';

const fakePs = (output) => () => ({ status: 0, stdout: output, stderr: '' });

/** Plant a wallpaper and generate the palette, so the CLI under test has data. */
function generatePalette(sandbox) {
  const image = makeImage(join(sandbox.wallDir, 'wall.png'));
  const result = runCli(['--no-set', image], { env: testEnv(sandbox) });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(readPaletteValues(join(sandbox.cache, 'palette')).st_fg, 'the palette must carry st keys');
}

// --- monet-apply -------------------------------------------------------------

test('findStTtys finds the pty through st\'s child, not st\'s own tty', () => {
  // The bug this pins down: an st started from the console keeps tty1 as its own
  // controlling terminal (ps prints "?" for it), while the pty the shell talks to
  // belongs to the CHILD process. Looking at st's own tty therefore finds nothing.
  const psOut = [
    '3167593 3166588 ?         st',
    '3167594 3167593 pts/0     zsh',
  ].join('\n');
  const spawn = () => ({ status: 0, stdout: psOut });
  assert.deepEqual(findStTtys({ spawn }), ['/dev/pts/0']);
});

test('findStTtys keeps only what belongs to st, deduplicated and sorted', () => {
  const psOut = [
    '  100   1 pts/3     kitty',        // 不是 st,必须忽略
    '  200   1 ?         st',           // st,自己的 tty 是控制台
    '  201 200 pts/2     zsh',          // 子进程 = 真正的 pty
    '  202 200 pts/7     zsh',          // 同一 st 的另一个子进程
    '  203 201 pts/2     vim',          // 孙进程,同一个 pty -> 去重
    '  300   1 pts/9     st',           // 从终端里启动的 st:自己的 tty 就是 pts
    '  301 300 pts/9     zsh',          // 子进程同一个 pty -> 去重
  ].join('\n');
  const spawn = () => ({ status: 0, stdout: psOut });
  assert.deepEqual(findStTtys({ spawn }), ['/dev/pts/2', '/dev/pts/7', '/dev/pts/9']);
});

test('findStTtys reports a broken ps instead of pretending there are no terminals', () => {
  assert.throws(() => findStTtys({ spawn: () => ({ status: 1, stdout: '' }) }), /ps exited 1/);
  assert.throws(
    () => findStTtys({ spawn: () => ({ error: new Error('boom'), status: 0 }) }),
    /could not run ps: boom/,
  );
});

function runMonetApply(args, env) {
  return spawnSync(process.execPath, [join(repoRoot, 'bin', 'monet-apply'), ...args], {
    encoding: 'utf8',
    env,
  });
}

test('monet-apply explains itself when there is no palette yet', () => {
  const sandbox = makeSandbox();
  const result = runMonetApply([], { ...testEnv(sandbox), MONET_CACHE_DIR: join(sandbox.root, 'empty') });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read .*palette/);
  assert.match(result.stderr, /run wall-monet first/);
});

test('monet-apply refuses a palette generated before st_* keys existed', () => {
  const sandbox = makeSandbox();
  writeFileSync(join(sandbox.cache, 'palette'), 'norm_bg=#0a0f10\nnorm_fg=#ffffff\n');
  const result = runMonetApply([], testEnv(sandbox));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /has no st_color0/);
});


// A `ps` that reports no processes at all: keeps these tests hermetic even when a
// real st is running on the machine the test suite happens to execute on.
const emptyPsEnv = (sandbox) => {
  const dir = join(sandbox.root, 'empty-ps');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'ps');
  writeFileSync(path, '#!/bin/sh\nprintf ""\n', { mode: 0o755 });
  chmodSync(path, 0o755);
  return { ...testEnv(sandbox), PATH: `${dir}:${process.env.PATH}` };
};

test('monet-apply still runs when invoked through the symlink install.sh creates', () => {
  // install.sh links ~/.local/bin/monet-apply -> <dest>/bin/monet-apply, and Node
  // resolves import.meta.url to the real path while argv[1] keeps the symlink. A
  // naive "is this the entry point" comparison made the tool exit silently with
  // status 0 -- no output, no retint, no error.
  const sandbox = makeSandbox();
  generatePalette(sandbox);
  const linkDir = join(sandbox.root, 'bin');
  mkdirSync(linkDir, { recursive: true });
  const link = join(linkDir, 'monet-apply');
  symlinkSync(join(repoRoot, 'bin', 'monet-apply'), link);

  const viaLink = spawnSync(process.execPath, [link, '--dry-run', '--verbose'], {
    encoding: 'utf8',
    env: emptyPsEnv(sandbox),
  });
  assert.equal(viaLink.status, 0, viaLink.stderr);
  assert.match(viaLink.stdout, /no running st found/, 'the symlinked invocation must actually run');

  const help = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8', env: testEnv(sandbox) });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: monet-apply/);
});

test('monet-apply is a no-op with exit 0 when no st is running', () => {
  // Stub ps to report nothing: this must hold regardless of what is running on the
  // machine the suite executes on (a real st used to be found here, and the test then
  // wrote escape sequences into the developer's terminal).
  const sandbox = makeSandbox();
  generatePalette(sandbox);
  const result = runMonetApply(['--verbose'], emptyPsEnv(sandbox));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no running st found/);
});

test('monet-apply names the ttys it would write to, and writes nothing in dry-run', () => {
  const sandbox = makeSandbox();
  generatePalette(sandbox);
  const values = readPaletteValues(join(sandbox.cache, 'palette'));

  const stubDir = join(sandbox.root, 'ps-stub');
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(join(stubDir, 'ps'), '#!/bin/sh\nprintf "300 1 ? st\\n301 300 pts/3 zsh\\n302 300 pts/5 zsh\\n301 300 pts/3 zsh\\n"\n', { mode: 0o755 });
  chmodSync(join(stubDir, 'ps'), 0o755);

  const result = runMonetApply(['--dry-run'], {
    ...testEnv(sandbox),
    PATH: `${stubDir}:${process.env.PATH}`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /would write \d+ bytes to: \/dev\/pts\/3 \/dev\/pts\/5/);
  assert.equal(
    Number(result.stdout.match(/would write (\d+) bytes/)[1]),
    oscSequences(values).length,
    'the byte count must be the real sequence length',
  );
});

test('monet-apply reports a tty it cannot write to', () => {
  const sandbox = makeSandbox();
  generatePalette(sandbox);
  const stubDir = join(sandbox.root, 'ps-stub2');
  mkdirSync(stubDir, { recursive: true });
  // /dev/pts/999 does not exist, so the write must fail loudly rather than silently.
  writeFileSync(join(stubDir, 'ps'), '#!/bin/sh\nprintf "300 1 ? st\\n301 300 pts/999 zsh\\n"\n', { mode: 0o755 });
  chmodSync(join(stubDir, 'ps'), 0o755);
  const result = runMonetApply([], { ...testEnv(sandbox), PATH: `${stubDir}:${process.env.PATH}` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not write to \/dev\/pts\/999/);
});

// --- dmenu_palette -----------------------------------------------------------

function dmenuStub(dir, logPath) {
  const path = join(dir, 'dmenu');
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\ncat >/dev/null 2>&1 || true\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  const dmenuPath = join(dir, 'dmenu_path');
  writeFileSync(dmenuPath, '#!/bin/sh\nprintf "alpha\\nbeta\\n"\n', { mode: 0o755 });
  chmodSync(dmenuPath, 0o755);
  return dir;
}

function paletteEnv(sandbox) {
  const dir = makeTmpDir();
  const log = join(dir, 'dmenu.log');
  dmenuStub(dir, log);
  return { env: { ...testEnv(sandbox), PATH: `${dir}:${process.env.PATH}` }, log };
}

function runDmenuPalette(args, options) {
  return spawnSync('sh', [join(repoRoot, 'bin', 'dmenu_palette'), ...args], { encoding: 'utf8', ...options });
}

test('dmenu_palette in filter mode passes the palette colours and the caller args through', () => {
  const sandbox = makeSandbox();
  generatePalette(sandbox);
  const values = readPaletteValues(join(sandbox.cache, 'palette'));

  const { env, log } = paletteEnv(sandbox);
  const result = runDmenuPalette(['-fn', 'monospace:size=11', '-m', '0'], { env, input: 'one\ntwo\n' });
  assert.equal(result.status, 0, result.stderr);

  const call = readFileSync(log, 'utf8').trim();
  // normal = bar base, selected = bar status/selected chip (same direction).
  assert.match(call, new RegExp(`-nb ${values.norm_bg}`));
  assert.match(call, new RegExp(`-nf ${values.norm_fg}`));
  assert.match(call, new RegExp(`-sb ${values.tag_sel_bg}`));
  assert.match(call, new RegExp(`-sf ${values.tag_sel_fg}`));
  assert.match(call, /-fn monospace:size=11 -m 0/, 'the caller arguments must survive');
});

test('dmenu_palette in launcher mode builds its own candidate list', () => {
  const sandbox = makeSandbox();
  generatePalette(sandbox);
  const { env, log } = paletteEnv(sandbox);

  // stdio "ignore" is /dev/null -- exactly what a dwm spawn looks like, and a
  // character device rather than a pipe, which is what selects launcher mode.
  const result = runDmenuPalette([], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.status, 0, result.stderr);

  // The launcher backgrounds its pipeline, so give the stub a moment to run.
  const deadline = Date.now() + 2000;
  let called = false;
  while (Date.now() < deadline && !called) {
    try {
      called = readFileSync(log, 'utf8').includes('-nb');
    } catch {
      /* not yet */
    }
  }
  assert.ok(called, 'dmenu should have been invoked by the launcher path');
});

test('dmenu_palette falls back to compiled colours when there is no palette', () => {
  const sandbox = makeSandbox();
  const { env, log } = paletteEnv(sandbox);
  const result = runDmenuPalette(['-i'], {
    env: { ...env, MONET_CACHE_DIR: join(sandbox.root, 'no-such-cache') },
    input: 'x\n',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(log, 'utf8'), /-nb #2e3440 -nf #d8dee9 -sb #5e81ac -sf #eceff4/);
});

// --- shell startup snippet ---------------------------------------------------

function sourceSnippet(sandbox, term) {
  const script = [
    `TERM=${term}`,
    `MONET_CACHE_DIR=${sandbox.cache}`,
    `. ${join(repoRoot, 'contrib', 'shell-rc-monet.sh')}`,
  ].join('\n');
  return spawnSync('sh', ['-c', script], { encoding: 'utf8', env: testEnv(sandbox) });
}

test('the shell snippet emits the OSC sequence for st, and nothing for other terminals', () => {
  const sandbox = makeSandbox();
  generatePalette(sandbox);
  const values = readPaletteValues(join(sandbox.cache, 'palette'));

  const forSt = sourceSnippet(sandbox, 'st-256color');
  assert.equal(forSt.status, 0, forSt.stderr);
  assert.equal(forSt.stdout, oscSequences(values), 'the snippet must emit exactly the same sequence');

  const forOther = sourceSnippet(sandbox, 'xterm-256color');
  assert.equal(forOther.status, 0, forOther.stderr);
  assert.equal(forOther.stdout, '', 'other terminals must be left alone');
});

test('the shell snippet stays quiet when the palette does not exist yet', () => {
  const sandbox = makeSandbox();
  mkdirSync(sandbox.cache, { recursive: true });
  const result = sourceSnippet(sandbox, 'st-256color');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('the archived statusbar.sh keeps its readable fallback colour', () => {
  const text = readFileSync(join(repoRoot, 'contrib', 'statusbar.sh'), 'utf8');
  assert.match(text, /COLOR_TEXT="#d8dee9"/);
  assert.doesNotMatch(text, /COLOR_TEXT="#00263e"/, 'the invisible fallback must be gone');
});
