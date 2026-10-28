// Finding the terminals to retint.
//
// st's pty is not reachable from X, so the only honest way to find "the st windows"
// is to ask the process table. The subtlety: an st started from the console keeps
// tty1 as its OWN controlling terminal (ps prints "?" for it), while the pty that
// actually matters belongs to the child process -- the shell running inside st. So we
// look at st's descendants and take their ttys, not st's own.
//
// Only pts/* ttys are returned: a console tty cannot render an OSC sequence, and a
// terminal which is not st is never touched (we only walk down from processes named
// `st`).
import { spawnSync } from 'node:child_process';

/**
 * @returns {string[]} absolute pty paths owned by st processes or their descendants,
 *   deduplicated and sorted by pty number
 */
export function findStTtys({ spawn = spawnSync, ps = 'ps', name = 'st' } = {}) {
  const result = spawn(ps, ['-eo', 'pid=,ppid=,tty=,comm='], { encoding: 'utf8' });
  if (result.error) throw new Error(`could not run ${ps}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${ps} exited ${result.status}`);

  /** @type {Map<string, {tty: string, comm: string}>} */
  const procs = new Map();
  /** @type {Map<string, string[]>} */
  const children = new Map();
  for (const line of String(result.stdout ?? '').split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) continue;
    const [pid, ppid, tty, comm] = fields;
    procs.set(pid, { tty, comm });
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }

  const found = new Set();
  for (const [pid, proc] of procs) {
    if (proc.comm !== name) continue;
    const queue = [pid];
    while (queue.length > 0) {
      const current = queue.pop();
      const tty = procs.get(current)?.tty;
      // "?" means no controlling terminal; tty1 and friends are consoles, which
      // cannot render colour escapes.
      if (tty && /^pts\/\d+$/.test(tty)) found.add(`/dev/${tty}`);
      for (const child of children.get(current) ?? []) queue.push(child);
    }
  }

  return [...found].sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()));
}
