// Tell the running dwm that the palette changed.
//
// dwm interns _MONET_PALETTE and, on PropertyNotify for the root window with
// that atom, calls reloadpalette() -- it never looks at the value. We shell out
// to xprop for this, which keeps the dependency set at one pure-JS package; a
// missing DISPLAY is not an error worth failing the run over, because dwm also
// loads whatever palette is on disk when it starts.
import { spawnSync } from 'node:child_process';

export const MONET_ATOM = '_MONET_PALETTE';

export function notifyDwm(value, env = process.env, { spawn = spawnSync, xprop = 'xprop' } = {}) {
  if (!env.DISPLAY) {
    return { ok: false, skipped: true, reason: 'DISPLAY is not set, so there is no dwm to notify' };
  }
  const args = ['-root', '-f', MONET_ATOM, '8s', '-set', MONET_ATOM, value];
  let result;
  try {
    // The child must see the same environment DISPLAY was read from, otherwise
    // a re-pointed DISPLAY/PATH would be checked and then silently ignored.
    result = spawn(xprop, args, { encoding: 'utf8', env });
  } catch (error) {
    return { ok: false, skipped: false, reason: `could not run ${xprop}: ${error.message}` };
  }
  if (result.error) {
    return { ok: false, skipped: false, reason: `could not run ${xprop}: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr).trim() : '';
    return { ok: false, skipped: false, reason: `${xprop} exited ${result.status}${stderr ? `: ${stderr}` : ''}` };
  }
  return { ok: true, skipped: false, args };
}
