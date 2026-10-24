import path from 'node:path';
import fs from 'node:fs/promises';
import { listStoredSessions } from '#runtime';
import { list, deleteSession } from '../../tools/szkrabok_session.js';

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

// Glob delete is a CLI convenience (trusted local user). The MCP tool takes
// exact names only (hardening proposal D5); the CLI expands the pattern
// against stored session names and deletes each match by exact name.
const globToRegExp = pattern =>
  new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

const readJson = async file => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
};

export function register(program, { safe }) {
  const session = program.command('session').description('Session management');

  session.command('list').action(
    safe(async () => {
      const { sessions } = await list();
      console.table(
        sessions.map(s => ({
          ID: s.id,
          Active: s.active ? 'yes' : 'no',
          Clone: s.isClone ? 'yes' : 'no',
          Template:
            s.templateSession !== null && s.templateSession !== undefined
              ? s.templateSession
              : 'N/A',
          Preset: s.preset !== null && s.preset !== undefined ? s.preset : 'N/A',
          Label: s.label !== null && s.label !== undefined ? s.label : 'N/A',
        }))
      );
    })
  );

  session.command('inspect <id>').action(
    safe(async id => {
      const dir = path.join(SESSIONS_DIR, id);
      const [meta, state] = await Promise.all([
        readJson(path.join(dir, 'meta.json')),
        readJson(path.join(dir, 'state.json')),
      ]);

      if (!meta || !state) throw new Error(`Session ${id} not found`);

      console.log('=== METADATA ===');
      console.log(JSON.stringify(meta, null, 2));
      console.log('\n=== COOKIES ===');
      let cookiesCount;
      if (state.cookies !== null && state.cookies !== undefined) {
        cookiesCount = state.cookies.length;
      } else {
        cookiesCount = 0;
      }
      console.log(cookiesCount, 'cookies');
      console.log('\n=== LOCALSTORAGE ===');
      let origins;
      if (state.origins !== null && state.origins !== undefined) {
        origins = state.origins;
      } else {
        origins = [];
      }
      for (const origin of origins) {
        let localStorageCount;
        if (origin.localStorage !== null && origin.localStorage !== undefined) {
          localStorageCount = origin.localStorage.length;
        } else {
          localStorageCount = 0;
        }
        console.log(origin.origin, ':', localStorageCount, 'items');
      }
    })
  );

  session
    .command('delete <id>')
    .description('Delete a session; "*" matches any characters')
    .action(
      safe(async id => {
        if (!id.includes('*')) {
          await deleteSession({ sessionName: id });
          console.log(`Session ${id} deleted`);
          return;
        }
        const re = globToRegExp(id);
        const matched = (await listStoredSessions()).filter(name => re.test(name));
        if (matched.length === 0) {
          console.log(`No sessions match ${id}`);
          return;
        }
        for (const name of matched) {
          await deleteSession({ sessionName: name });
          console.log(`Session ${name} deleted`);
        }
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
              const meta = await readJson(path.join(SESSIONS_DIR, e.name, 'meta.json'));
              if (
                meta !== null &&
                meta !== undefined &&
                meta.lastUsed !== null &&
                meta.lastUsed !== undefined &&
                meta.lastUsed < cutoff
              ) {
                await deleteSession({ sessionName: e.name });
                console.log(`Deleted: ${e.name}`);
              }
            })
        );
      })
    );
}
