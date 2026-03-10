#!/usr/bin/env node

import { program } from 'commander';
import path from 'node:path';
import fs from 'node:fs/promises';
import { list, deleteSession, endpoint } from './tools/szkrabok_session.js';

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

program
  .name('bebok')
  .description('szkrabok CLI')
  .version('2.0.0');

/* ---------- helpers ---------- */

const readJson = async file => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
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
  .argument('<action>', 'list | inspect | delete | cleanup')
  .argument('[id]', 'Session ID')
  .option('--days <days>', 'For cleanup: delete sessions older than N days', '30')
  .action(async (action, id, options) => {
    const actions = {
      list: async () => {
        const { sessions } = await list();
        console.table(
          sessions.map(s => ({
            ID: s.id,
            Active: s.active ? 'yes' : 'no',
            Preset: s.preset ?? 'N/A',
            Label: s.label ?? 'N/A',
          }))
        );
      },

      inspect: async () => {
        if (!id) throw new Error('Session ID required');

        const dir = path.join(SESSIONS_DIR, id);
        const [meta, state] = await Promise.all([
          readJson(path.join(dir, 'meta.json')),
          readJson(path.join(dir, 'state.json')),
        ]);

        if (!meta || !state) throw new Error(`Session ${id} not found or incomplete`);

        console.log('=== METADATA ===');
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
        await deleteSession({ sessionName: id });
        console.log(`Session ${id} deleted`);
      },

      cleanup: async () => {
        const days = Number(options.days) || 30;
        const cutoff = Date.now() - days * 86400000;

        let entries;
        try {
          entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
        } catch {
          console.log('No sessions directory found');
          return;
        }

        await Promise.all(
          entries
            .filter(e => e.isDirectory())
            .map(async e => {
              const meta = await readJson(path.join(SESSIONS_DIR, e.name, 'meta.json'));
              if (meta?.lastUsed && meta.lastUsed < cutoff) {
                await deleteSession({ sessionName: e.name });
                console.log(`Deleted old session: ${e.name}`);
              }
            })
        );
      },
    };

    const fn = actions[action];
    if (!fn) {
      console.error(`Unknown action: ${action}. Use: list | inspect | delete | cleanup`);
      process.exit(1);
    }

    try {
      await fn();
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

/* ---------- open command ---------- */

program
  .command('open <profile>')
  .description(
    'Launch a browser session with stealth + persistence. Prints CDP endpoint. Runs until Ctrl-C.'
  )
  .option('--preset <preset>', 'TOML preset name')
  .option('--headless', 'Run headless')
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

/* ---------- endpoint command ---------- */

program
  .command('endpoint <sessionName>')
  .description('Print CDP and WS endpoints for a running session')
  .action(async sessionName => {
    try {
      const result = await endpoint({ sessionName });
      console.log(`CDP: ${result.cdpEndpoint}`);
      if (result.wsEndpoint) console.log(`WS:  ${result.wsEndpoint}`);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

program.parse();
