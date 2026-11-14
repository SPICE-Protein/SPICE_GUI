import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSpdMock, stopSpdMock } from './spdMock.js';
import { AI_MOCK_URL, startAiMock, stopAiMock } from './aiMock.js';
import { startBlastMock, stopBlastMock } from './blastMock.js';

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

if (!existsSync(appBinaryPath)) {
  throw new Error(
    `E2E app binary not found at ${appBinaryPath}. Run "pnpm e2e:build" first ` +
      '(or point SPICE_E2E_BINARY at a build made with --features webdriver).',
  );
}

// ---------------------------------------------------------------------------
// WebDriver port selection
//
// The service always spawns the app against a fixed port. If a previous run
// was killed before teardown, its app keeps the port and the new app silently
// fails to bind, while the readiness probe happily talks to the stale
// instance. Everything then stalls on a dead session. Clean up our own stale
// app or move to a free port before the service starts.
// ---------------------------------------------------------------------------

const preferredEmbeddedPort = Number(process.env.SPICE_E2E_PORT || 4445);

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidsOnPort(port) {
  try {
    return execFileSync('lsof', ['-ti', `:${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function commandOf(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

async function waitForFreePort(port, attempts) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isPortFree(port)) return true;
    await sleep(250);
  }
  return false;
}

async function resolveEmbeddedPort(preferred) {
  if (await isPortFree(preferred)) return preferred;

  if (process.platform !== 'win32') {
    const stale = pidsOnPort(preferred).filter((pid) =>
      commandOf(pid).includes(appBinaryPath),
    );
    if (stale.length > 0) {
      console.warn(
        `[e2e] killing stale app process(es) holding port ${preferred}: ${stale.join(', ')}`,
      );
      for (const pid of stale) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Already gone.
        }
      }
      if (!(await waitForFreePort(preferred, 20))) {
        for (const pid of stale) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
        await waitForFreePort(preferred, 8);
      }
      if (await isPortFree(preferred)) return preferred;
    }
  }

  for (let port = preferred + 1; port <= preferred + 20; port += 1) {
    if (await isPortFree(port)) {
      console.warn(
        `[e2e] port ${preferred} is in use by another process; using ${port}`,
      );
      return port;
    }
  }
  throw new Error(
    `No free WebDriver port in ${preferred}-${preferred + 20}. Release the port or set SPICE_E2E_PORT.`,
  );
}

// wdio evaluates this config twice: once in the launcher (which spawns the
// app) and again in every worker (which only connects). Resolving the port in
// a worker would see the launcher's freshly spawned app as a "stale" holder
// and kill the session out from under the run. Cache the launcher's decision
// in the environment, which forked workers inherit.
async function resolveEmbeddedPortOnce() {
  const inherited = Number(process.env.SPICE_E2E_RESOLVED_PORT || 0);
  if (Number.isInteger(inherited) && inherited > 0) return inherited;
  const port = await resolveEmbeddedPort(preferredEmbeddedPort);
  process.env.SPICE_E2E_RESOLVED_PORT = String(port);
  return port;
}

const embeddedPort = await resolveEmbeddedPortOnce();

// One local SPD stand-in per run. Specs point the app at SPD_MOCK_URL, so the
// real client + Rust bridge execute against stable fixtures.
let spdMockServer = null;
let aiMockServer = null;
let blastMockServer = null;

export const config = {
  // Hooks live in the config object itself: the CLI launcher reads them from
  // the parsed config, not from bare module exports.
  onPrepare: async () => {
    console.log(`[e2e] app binary: ${appBinaryPath}`);
    console.log(`[e2e] embedded WebDriver port: ${embeddedPort}`);
    spdMockServer = await startSpdMock();
    aiMockServer = await startAiMock();
    blastMockServer = await startBlastMock();
    // Copilot specs point the app at this endpoint after each localStorage reset.
    process.env.SPICE_AI_MOCK_URL = AI_MOCK_URL;
  },
  onComplete: async () => {
    await stopSpdMock(spdMockServer);
    await stopAiMock(aiMockServer);
    await stopBlastMock(blastMockServer);
    spdMockServer = null;
    aiMockServer = null;
    blastMockServer = null;
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
        embeddedPort,
        // Bound startup and per-command waits: a broken build should fail in
        // under a minute instead of appearing to hang for several.
        startTimeout: 60000,
        commandTimeout: 60000,
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
  waitforTimeout: 15000,
  // One retry against a shorter budget still covers a transient WebView hiccup,
  // but cannot turn into a multi-minute silence when the session is dead.
  connectionRetryTimeout: 60000,
  connectionRetryCount: 1,
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    // Per-test budget. The slowest real test runs well under a minute; 120s
    // leaves headroom while a wedged command still surfaces as a failure.
    timeout: 120000,
  },
  reporters: ['spec'],
};
