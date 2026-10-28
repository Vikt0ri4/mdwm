// Telling dwm to reload. No X server is involved: xprop is stubbed on PATH.
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { MONET_ATOM, notifyDwm } from '../src/notify.js';
import { makeTmpDir, readStubLog, writeStub } from './helpers.js';

test('without DISPLAY nothing is run and the caller is told why', () => {
  const dir = makeTmpDir();
  const log = join(dir, 'log');
  writeStub(dir, 'xprop', log);
  const result = notifyDwm('dark', { PATH: dir });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /DISPLAY is not set/);
  assert.deepEqual(readStubLog(log), [], 'xprop must not be invoked at all');
});

test('with DISPLAY set the root property is set to the new theme', () => {
  const dir = makeTmpDir();
  const log = join(dir, 'log');
  writeStub(dir, 'xprop', log);
  const result = notifyDwm('light', { DISPLAY: ':0', PATH: dir });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.deepEqual(readStubLog(log), [`-root -f ${MONET_ATOM} 8s -set ${MONET_ATOM} light`]);
});

test('a failing xprop is reported rather than thrown', () => {
  const dir = makeTmpDir();
  const failing = join(dir, 'xprop');
  writeFileSync(failing, '#!/bin/sh\necho "unable to open display" >&2\nexit 1\n', { mode: 0o755 });
  chmodSync(failing, 0o755);
  const result = notifyDwm('dark', { DISPLAY: ':0', PATH: dir });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.match(result.reason, /exited 1: unable to open display/);
});

test('an absent xprop is reported rather than thrown', () => {
  const dir = makeTmpDir();
  const result = notifyDwm('dark', { DISPLAY: ':0', PATH: dir });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.match(result.reason, /could not run xprop/);
});
