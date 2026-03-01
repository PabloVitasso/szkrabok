#!/usr/bin/env node

import { program } from 'commander';
import path from 'path';
import fs from 'fs/promises';

program.name('bebok').description('BEBOK Playwright MCP CLI').version('2.0.0');

program
  .command('session')
  .description('Session management')
  .argument('<action>', 'list | open | inspect | delete')
  .argument('[id]', 'Session ID')
  .option('--url <url>', 'URL to open')
  .action(async (action, id, options) => {
    const sessionsDir = path.join(process.cwd(), 'sessions');
    switch (action) {
      case 'list': {
        const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
        const sessions = [];
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const metaPath = path.join(sessionsDir, entry.name, 'meta.json');
            try {
              const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
              sessions.push(meta);
            } catch {
              sessions.push({ id: entry.name, status: 'incomplete' });
            }
          }
        }
        console.table(
          sessions.map(s => ({
            ID: s.id,
            Created: s.created ? new Date(s.created).toLocaleDateString() : 'N/A',
            'Last Used': s.lastUsed ? new Date(s.lastUsed).toLocaleDateString() : 'N/A',
            URL: s.stats?.lastUrl || 'N/A',
          }))
        );
        break;
      }
      case 'open': {
        if (!id) {
          console.error('Session ID required for open action');
          process.exit(1);
        }
        console.log(`Session ${id} would be opened with MCP tools`);
        console.log(`Use: session_open({ sessionId: "${id}", url: "${options.url || ''}" })`);
        break;
      }
      case 'inspect': {
        if (!id) {
          console.error('Session ID required for inspect action');
          process.exit(1);
        }
        const sessionDir = path.join(sessionsDir, id);
        try {
          const [state, meta] = await Promise.all([
            fs.readFile(path.join(sessionDir, 'state.json'), 'utf-8'),
            fs.readFile(path.join(sessionDir, 'meta.json'), 'utf-8'),
          ]);
          console.log('=== SESSION METADATA ===');
          console.log(JSON.stringify(JSON.parse(meta), null, 2));
          const stateData = JSON.parse(state);
          console.log('\n=== COOKIES ===');
          console.log(stateData.cookies?.length || 0, 'cookies');
          console.log('\n=== LOCALSTORAGE ===');
          stateData.origins?.forEach(origin => {
            console.log(origin.origin, ':', origin.localStorage?.length || 0, 'items');
          });
        } catch (error) {
          console.error(`Cannot inspect session ${id}:`, error.message);
        }
        break;
      }
      case 'delete': {
        if (!id) {
          console.error('Session ID required for delete action');
          process.exit(1);
        }
        const dirToDelete = path.join(sessionsDir, id);
        try {
          await fs.rm(dirToDelete, { recursive: true, force: true });
          console.log(`Session ${id} deleted`);
        } catch (error) {
          console.error(`Cannot delete session ${id}:`, error.message);
        }
        break;
      }
    }
  });

program
  .command('cleanup')
  .description('Clean up old sessions')
  .option('--days <days>', 'Delete sessions older than N days', '30')
  .action(async options => {
    const sessionsDir = path.join(process.cwd(), 'sessions');
    const cutoff = Date.now() - parseInt(options.days) * 24 * 60 * 60 * 1000;
    try {
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(sessionsDir, entry.name, 'meta.json');
          try {
            const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
            if (meta.lastUsed && meta.lastUsed < cutoff) {
              await fs.rm(path.join(sessionsDir, entry.name), { recursive: true });
              console.log(`Deleted old session: ${entry.name}`);
            }
          } catch {
            // Skip incomplete sessions
          }
        }
      }
    } catch (error) {
      console.error('Cleanup failed:', error.message);
    }
  });

program
  .command('open <profile>')
  .description('Launch a browser session with full stealth + persistence. Prints CDP endpoint. Keeps process alive until Ctrl-C.')
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
    process.on('SIGINT', async () => {
      await handle.close();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await handle.close();
      process.exit(0);
    });
    // Keep alive
    await new Promise(() => {});
  });

program.parse();
