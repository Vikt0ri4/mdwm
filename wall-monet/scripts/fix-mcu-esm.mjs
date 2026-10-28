// Repair a packaging bug in @material/material-color-utilities 0.4.0.
//
// Ten of its shipped ESM files import relative paths without a file extension,
// for example:
//   scheme/scheme_tonal_spot.js  ->  from '../dynamiccolor/dynamic_scheme'
//   dynamiccolor/color_spec_2025.js -> from './dynamic_color'
// Bundlers happily guess the ".js"; Node's ESM resolver does not, so a plain
// `import '@material/material-color-utilities'` dies with ERR_MODULE_NOT_FOUND.
// That is fatal for us because specVersion '2025' lives behind exactly these
// files.
//
// pnpm users get this fixed through patches/ (see pnpm-workspace.yaml). This
// script is the same fix for npm, and a no-op wherever the patch already
// applied. It never fails an install: if the package is absent or already
// clean, it exits quietly.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE = '@material/material-color-utilities';
const root = join(process.cwd(), 'node_modules', ...PACKAGE.split('/'));

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsFiles(path);
    return name.endsWith('.js') ? [path] : [];
  });
}

try {
  statSync(root);
} catch {
  // Not installed here (for example a workspace root): nothing to do.
  process.exit(0);
}

let fixed = 0;
for (const file of jsFiles(root)) {
  const source = readFileSync(file, 'utf8');
  const patched = source.replace(/(from\s+)(["'])(\.\.?\/[^"']*)(\2)/g, (match, keyword, quote, specifier, closing) => {
    if (/\.[cm]?js$/.test(specifier) || specifier.endsWith('/')) return match;
    return `${keyword}${quote}${specifier}.js${closing}`;
  });
  if (patched !== source) {
    writeFileSync(file, patched);
    fixed++;
  }
}

if (fixed > 0) {
  process.stdout.write(`wall-monet: repaired ${fixed} extensionless ESM import(s) in ${PACKAGE}\n`);
}
