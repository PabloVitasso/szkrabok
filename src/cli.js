#!/usr/bin/env node

import { program } from 'commander';
import path from 'node:path';
import fs from 'node:fs/promises';

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

program
  .name('bebok')
  .description('BEBOK Playwright MCP CLI')
  .version('2.0.0');

/* ---------- helpers ---------- */

const readJson = async file => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
};

const sessionPath = id => path.join(SESSIONS_DIR, id);

const ensureSessionsDir = async () => {
  try {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
  } catch {}
};

const shutdownHandler = handle => async () => {
  try {
    await handle.close();
  } finally {
    process.exit(0);
  }
};

/* ---------- session command ---------- */

program
  .command('session')
  .description('Session management')
  .argument('<action>', 'list | open | inspect | delete')
  .argument('[id]', 'Session ID')
  .option('--url <url>', 'URL to open')
  .action(async (action, id, options) => {
    await ensureSessionsDir();

    const actions = {
      list: async () => {
        const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });

        const sessions = await Promise.all(
          entries
            .filter(e => e.isDirectory())
            .map(async e => {
              const meta = await readJson(path.join(SESSIONS_DIR, e.name, 'meta.json'));
              return meta ?? { id: e.name, status: 'incomplete' };
            })
        );

        console.table(
          sessions.map(s => ({
            ID: s.id,
            Created: s.created ? new Date(s.created).toLocaleDateString() : 'N/A',
            'Last Used': s.lastUsed ? new Date(s.lastUsed).toLocaleDateString() : 'N/A',
            URL: s.stats?.lastUrl ?? 'N/A',
          }))
        );
      },

      open: async () => {
        if (!id) throw new Error('Session ID required');
        console.log(`Session ${id} would be opened with MCP tools`);
        console.log(`Use: session_open({ sessionId: "${id}", url: "${options.url ?? ''}" })`);
      },

      inspect: async () => {
        if (!id) throw new Error('Session ID required');

        const dir = sessionPath(id);

        const [meta, state] = await Promise.all([
          readJson(path.join(dir, 'meta.json')),
          readJson(path.join(dir, 'state.json')),
        ]);

        if (!meta || !state) throw new Error(`Session ${id} incomplete`);

        console.log('=== SESSION METADATA ===');
        console.log(JSON.stringify(meta, null, 2));

        console.log('\n=== COOKIES ===');
        console.log(state.cookies?.length ?? 0, 'cookies');

        console.log('\n=== LOCALSTORAGE ===');
        for (const origin of state.origins ?? []) {
          console.log(origin.origin, ':', origin.localStorage?.length ?? 0, 'items');
        }
      },

      delete: async () => {
        if (!id) throw new Error('Session ID required');

        await fs.rm(sessionPath(id), { recursive: true, force: true });
        console.log(`Session ${id} deleted`);
      },
    };

    const fn = actions[action];
    if (!fn) {
      console.error(`Unknown action: ${action}`);
      process.exit(1);
    }

    try {
      await fn();
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

/* ---------- cleanup command ---------- */

program
  .command('cleanup')
  .description('Clean up old sessions')
  .option('--days <days>', 'Delete sessions older than N days', '30')
  .action(async options => {
    await ensureSessionsDir();

    const days = Number(options.days) || 30;
    const cutoff = Date.now() - days * 86400000;

    const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });

    await Promise.all(
      entries
        .filter(e => e.isDirectory())
        .map(async e => {
          const meta = await readJson(path.join(SESSIONS_DIR, e.name, 'meta.json'));
          if (meta?.lastUsed && meta.lastUsed < cutoff) {
            await fs.rm(sessionPath(e.name), { recursive: true, force: true });
            console.log(`Deleted old session: ${e.name}`);
          }
        })
    );
  });

/* ---------- browser open ---------- */

program
  .command('open <profile>')
  .description(
    'Launch browser session with stealth + persistence. Prints CDP endpoint. Runs until Ctrl-C.'
  )
  .option('--preset <preset>')
  .option('--headless')
  .action(async (profile, options) => {
    const { launch } = await import('@szkrabok/runtime');

    const handle = await launch({
      profile,
      preset: options.preset,
      headless: options.headless ?? undefined,
      reuse: false,
    });

    console.log(handle.cdpEndpoint);

    const shutdown = shutdownHandler(handle);

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await new Promise(() => {});
  });

program.parse();
