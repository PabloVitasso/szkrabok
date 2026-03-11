import path from 'node:path';
import fs from 'node:fs/promises';
import { list, deleteSession } from '../../tools/szkrabok_session.js';

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

const readJson = async file => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
};

export function register(program, { safe }) {
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

        if (!meta || !state) throw new Error(`Session ${id} not found`);

        console.log('=== METADATA ===');
        console.log(JSON.stringify(meta, null, 2));
        console.log('\n=== COOKIES ===');
        console.log(state.cookies?.length ?? 0, 'cookies');
        console.log('\n=== LOCALSTORAGE ===');
        for (const origin of state.origins ?? []) {
          console.log(origin.origin, ':', origin.localStorage?.length ?? 0, 'items');
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
              const meta = await readJson(path.join(SESSIONS_DIR, e.name, 'meta.json'));
              if (meta?.lastUsed && meta.lastUsed < cutoff) {
                await deleteSession({ sessionName: e.name });
                console.log(`Deleted: ${e.name}`);
              }
            })
        );
      })
    );
}
