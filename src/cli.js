import { program } from 'commander';
import path from 'node:path';
import fs from 'node:fs/promises';

import { list, deleteSession, endpoint } from './tools/szkrabok_session.js';

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

/* ---------- lazy runtime ---------- */

let runtime;
const getRuntime = async () => {
  if (!runtime) runtime = await import('#runtime');
  return runtime;
};

/* ---------- helpers ---------- */

const readJson = async file => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
};

const safe = fn => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    console.error(err?.message ?? err);
    process.exit(1);
  }
};

const attachShutdown = handle => {
  let closing = false;

  const shutdown = async () => {
    if (closing) return;
    closing = true;

    try {
      await handle.close();
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

/* ---------- program ---------- */

program
  .name('szkrabok')
  .description('szkrabok CLI')
  .version('1.0.16');

/* ---------- init ---------- */

program
  .command('init')
  .description('Scaffold minimal config')
  .action(
    safe(async () => {
      const { init } = await import('./tools/scaffold.js');

      const result = await init({
        dir: process.cwd(),
        preset: 'minimal',
        install: false,
      });

      if (result.created.length)
        console.error(`Created: ${result.created.join(', ')}`);

      if (result.merged.length)
        console.error(`Merged: ${result.merged.join(', ')}`);

      if (result.skipped.length)
        console.error(`Skipped: ${result.skipped.join(', ')}`);

      for (const w of result.warnings)
        console.error(`Warning: ${w}`);

      console.error(
        'Done. Run "szkrabok install-browser" if Chromium is not installed.'
      );
    })
  );

/* ---------- session ---------- */

const session = program.command('session').description('Session management');

session
  .command('list')
  .action(
    safe(async () => {
      const { sessions } = await list();

      console.table(
        sessions.map(s => ({
          ID: s.id,
          Active: s.active ? 'yes' : 'no',
          Preset: s.preset ?? 'N/A',
          Label: s.label ?? 'N/A',
        }))
      );
    })
  );

session
  .command('inspect <id>')
  .action(
    safe(async id => {
      const dir = path.join(SESSIONS_DIR, id);

      const [meta, state] = await Promise.all([
        readJson(path.join(dir, 'meta.json')),
        readJson(path.join(dir, 'state.json')),
      ]);

      if (!meta || !state)
        throw new Error(`Session ${id} not found`);

      console.log('=== METADATA ===');
      console.log(JSON.stringify(meta, null, 2));

      console.log('\n=== COOKIES ===');
      console.log(state.cookies?.length ?? 0, 'cookies');

      console.log('\n=== LOCALSTORAGE ===');

      for (const origin of state.origins ?? []) {
        console.log(
          origin.origin,
          ':',
          origin.localStorage?.length ?? 0,
          'items'
        );
      }
    })
  );

session
  .command('delete <id>')
  .action(
    safe(async id => {
      await deleteSession({ sessionName: id });
      console.log(`Session ${id} deleted`);
    })
  );

session
  .command('cleanup')
  .option('--days <days>', 'delete sessions older than N days', '30')
  .action(
    safe(async options => {
      const days = Number(options.days) || 30;
      const cutoff = Date.now() - days * 86400000;

      let entries;

      try {
        entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
      } catch {
        console.log('No sessions directory');
        return;
      }

      await Promise.all(
        entries
          .filter(e => e.isDirectory())
          .map(async e => {
            const meta = await readJson(
              path.join(SESSIONS_DIR, e.name, 'meta.json')
            );

            if (meta?.lastUsed && meta.lastUsed < cutoff) {
              await deleteSession({ sessionName: e.name });
              console.log(`Deleted: ${e.name}`);
            }
          })
      );
    })
  );

/* ---------- open ---------- */

program
  .command('open <profile>')
  .description('Launch persistent browser and print CDP endpoint')
  .option('--preset <preset>')
  .option('--headless')
  .action(
    safe(async (profile, options) => {
      const { launch } = await getRuntime();

      const handle = await launch({
        profile,
        preset: options.preset,
        headless: options.headless ?? undefined,
        reuse: false,
      });

      console.log(handle.cdpEndpoint);

      attachShutdown(handle);

      await new Promise(() => {});
    })
  );

/* ---------- endpoint ---------- */

program
  .command('endpoint <sessionName>')
  .description('Print CDP and WS endpoints')
  .action(
    safe(async sessionName => {
      const result = await endpoint({ sessionName });

      console.log(`CDP: ${result.cdpEndpoint}`);

      if (result.wsEndpoint)
        console.log(`WS:  ${result.wsEndpoint}`);
    })
  );

/* ---------- detect browser ---------- */

program
  .command('detect-browser')
  .description('Detect Chrome/Chromium')
  .action(
    safe(async () => {
      const { findChromiumPath } = await getRuntime();

      const chromiumPath = await findChromiumPath();

      if (!chromiumPath) {
        console.log('No Chromium detected\n');
        console.log('  szkrabok install-browser');
        process.exit(1);
      }

      console.log(chromiumPath);

      console.log('\nRecommended config:\n');
      console.log('[default]');
      console.log(`executablePath = "${chromiumPath}"`);
    })
  );

/* ---------- install browser ---------- */

program
  .command('install-browser')
  .description('Install Chromium via Playwright')
  .action(() => {
    import('node:child_process').then(({ spawn }) => {
      const proc = spawn('npx', ['playwright', 'install', 'chromium'], {
        stdio: 'inherit',
      });

      proc.on('close', code => process.exit(code ?? 0));
    });
  });

/* ---------- export ---------- */

export async function runCli() {
  await program.parseAsync(process.argv);
}
