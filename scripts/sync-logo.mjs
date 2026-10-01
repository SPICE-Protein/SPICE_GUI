// Sync the SPICE logo (../logo.png) into the GUI's static/ and Tauri icons.
// Falls back silently when the source logo is missing (existing assets kept).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, '..', 'logo.png'); // SPICE/logo.png

const targets = [
  join(root, 'static', 'spice-logo.png'),
  join(root, 'static', 'favicon.png'),
  join(root, 'src-tauri', 'icons', '32x32.png'),
  join(root, 'src-tauri', 'icons', '128x128.png'),
  join(root, 'src-tauri', 'icons', '128x128@2x.png'),
  join(root, 'src-tauri', 'icons', 'icon.png'),
];

if (!existsSync(src)) {
  console.log('[sync-logo] ../logo.png not found — keeping existing assets.');
  process.exit(0);
}
for (const t of targets) {
  mkdirSync(dirname(t), { recursive: true });
  copyFileSync(src, t);
  console.log(`[sync-logo] ${src} -> ${t}`);
}
console.log('[sync-logo] done.');
