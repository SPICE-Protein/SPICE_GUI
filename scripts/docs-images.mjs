// Convert the PNG captures from e2e/specs/docs-screenshots.e2e.js into the WebP
// files embedded in docs/images. Usage:
//   node scripts/docs-images.mjs            (all captures)
//   node scripts/docs-images.mjs lab-*.png  (only matching files)
//
// Requires `cwebp` (brew install webp) and `sips` (macOS). Screenshots are
// resized to 2000 px wide, matching the existing manual images.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = path.join(root, 'build', 'docs-shots');
const WIDTH = 2000;
const QUALITY = 82;

// Workspace and bench-tool screenshots live in docs/images; the per-panel
// captures are embedded by the panel pages and live beside them.
const PANEL_PREFIXES = ['gene-', 'protein-pane-'];
function targetDirFor(base) {
  return PANEL_PREFIXES.some((prefix) => base.startsWith(prefix))
    ? path.join(root, 'docs', 'panels', 'images')
    : path.join(root, 'docs', 'images');
}

if (!existsSync(sourceDir)) {
  console.error(`No captures in ${sourceDir}. Run:`);
  console.error('  SPICE_DOCS_SCREENSHOTS=1 pnpm e2e --spec ./e2e/specs/docs-screenshots.e2e.js');
  process.exit(1);
}

const filters = process.argv.slice(2);
const pattern = filters.length > 0 ? new RegExp(filters.map((f) => f.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')).join('|')) : null;

const files = readdirSync(sourceDir)
  .filter((name) => name.endsWith('.png') && !name.includes('-resized'))
  .filter((name) => (pattern ? pattern.test(name) : true))
  .sort();

if (files.length === 0) {
  console.error(`No PNG files matched in ${sourceDir}`);
  process.exit(1);
}

for (const file of files) {
  const base = file.replace(/\.png$/, '');
  const input = path.join(sourceDir, file);
  const resized = path.join(sourceDir, `${base}-resized.png`);
  const targetDir = targetDirFor(base);
  mkdirSync(targetDir, { recursive: true });
  const output = path.join(targetDir, `${base}.webp`);

  execFileSync('sips', ['--resampleWidth', String(WIDTH), input, '--out', resized], { stdio: 'ignore' });
  execFileSync('cwebp', ['-quiet', '-q', String(QUALITY), resized, '-o', output], { stdio: 'inherit' });
  rmSync(resized, { force: true });

  const kb = (execFileSync('stat', ['-f', '%z', output], { encoding: 'utf8' }).trim() / 1024).toFixed(0);
  console.log(`${base}.webp  ${kb} kB`);
}
