import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSpdMock, stopSpdMock } from './spdMock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const tauriDir = path.join(root, 'src-tauri');
const binaryName = process.platform === 'win32' ? 'spice_gui.exe' : 'spice_gui';

// Honor the user's global Cargo target-dir (~/.cargo/config.toml) instead of
// assuming src-tauri/target. `cargo metadata` resolves the same directory the
// Tauri CLI compiled into.
const cargoMetadata = JSON.parse(
  execSync('cargo metadata --format-version 1 --no-deps', {
    cwd: tauriDir,
    encoding: 'utf8',
  }),
);
const appBinaryPath =
  process.env.SPICE_E2E_BINARY ||
  path.join(cargoMetadata.target_directory, 'debug', binaryName);

// One local SPD stand-in per run. Specs point the app at SPD_MOCK_URL, so the
// real client + Rust bridge execute against stable fixtures.
let spdMockServer = null;

export const config = {
  // Hooks live in the config object itself: the CLI launcher reads them from
  // the parsed config, not from bare module exports.
  onPrepare: async () => {
    spdMockServer = await startSpdMock();
  },
  onComplete: async () => {
    await stopSpdMock(spdMockServer);
    spdMockServer = null;
  },

  runner: 'local',
  specs: ['./specs/**/*.e2e.js'],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath,
        // The embedded server lives inside debug builds via
        // tauri-plugin-wdio-webdriver; no external tauri-driver is needed.
        driverProvider: 'embedded',
        embeddedPort: Number(process.env.SPICE_E2E_PORT || 4445),
      },
    ],
  ],

  capabilities: [
    {
      browserName: 'tauri',
      maxInstances: 1,
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],

  logLevel: process.env.WDIO_LOG_LEVEL || 'info',
  bail: 0,
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 300000,
  },
  reporters: ['spec'],
};
