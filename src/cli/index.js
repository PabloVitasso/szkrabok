import { program } from 'commander';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { register as registerInit } from './commands/init.js';
import { register as registerSession } from './commands/session.js';
import { register as registerOpen } from './commands/open.js';
import { register as registerEndpoint } from './commands/endpoint.js';
import { register as registerDetectBrowser } from './commands/detect-browser.js';
import { register as registerInstallBrowser } from './commands/install-browser.js';
import { register as registerDoctor } from './commands/doctor.js';

/* ---------- shared helpers ---------- */

const safe = fn => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    let msg;
    if (err !== null && err !== undefined && err.message !== null && err.message !== undefined) {
      msg = err.message;
    } else {
      msg = err;
    }
    console.error(msg);
    process.exit(1);
  }
};

const attachShutdown = handle => {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await handle.close(); } finally { process.exit(0); }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

let _runtime;
const getRuntime = async () => {
  if (!_runtime) _runtime = await import('#runtime');
  return _runtime;
};

/* ---------- version from package.json ---------- */

const _require = createRequire(import.meta.url);
const { version } = _require(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'));

/* ---------- program ---------- */

program.name('szkrabok').description('szkrabok CLI').version(version);

let _exitCode = 0;
const setExitCode = (code) => { _exitCode = code; };

const ctx = { safe, attachShutdown, getRuntime, setExitCode };

registerInit(program, ctx);
registerSession(program, ctx);
registerOpen(program, ctx);
registerEndpoint(program, ctx);
registerDetectBrowser(program, ctx);
registerInstallBrowser(program, ctx);
registerDoctor(program, ctx);

export async function runCli() {
  await program.parseAsync(process.argv);
  return _exitCode;
}
