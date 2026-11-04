// Tauri validates every capability file in src-tauri/capabilities, even ones
// not listed in tauri.conf.json. The wdio permissions only exist when the
// `webdriver` feature is enabled, so the e2e capability must not be present in
// release builds. Copy it in for this build only and always remove it again.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(root, 'src-tauri', 'e2e', 'e2e.capability.json');
const destination = path.join(root, 'src-tauri', 'capabilities', 'e2e.json');

function cleanup() {
  rmSync(destination, { force: true });
}

mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(source, destination);

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

try {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpm, [
    'exec',
    'tauri',
    'build',
    '--debug',
    '--no-bundle',
    '--features',
    'webdriver',
    '--config',
    'src-tauri/tauri.e2e.conf.json',
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  cleanup();
}
