// Logging policy: silent on success (the dwm keybindings must not pop anything
// up), errors always to stderr, and everything additionally appended to
// $CACHE/wall-monet.log only when --verbose is given. dwm writes its own
// diagnostics to $CACHE/dwm.log, so the two logs stay separable.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createLogger({ verbose = false, file = null, stderr = process.stderr } = {}) {
  const toFile = (level, message) => {
    if (!verbose || !file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${new Date().toISOString()} ${level} ${message}\n`);
    } catch {
      // A broken log must never break the run.
    }
  };

  const emit = (level, message, stream) => {
    stream.write(`wall-monet: ${message}\n`);
    toFile(level, message);
  };

  return {
    info(message) {
      if (verbose) emit('INFO', message, stderr);
      else toFile('INFO', message);
    },
    warn(message) {
      emit('WARN', message, stderr);
    },
    error(message) {
      emit('ERROR', message, stderr);
    },
  };
}
