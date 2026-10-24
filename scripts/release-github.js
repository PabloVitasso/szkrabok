import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const v = `v${pkg.version}`;

const run = (cmd, env = {}) =>
  execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

// GH_TOKEN in env skips keyring entirely — preferred over gh auth login
if (!process.env.GH_TOKEN) {
  try {
    execSync('gh auth status', { stdio: 'pipe' });
  } catch {
    console.error('ERROR: GitHub auth required. Either:');
    console.error('  GH_TOKEN=<token> npm run release:github');
    console.error('  gh auth login');
    process.exit(1);
  }
}

console.log(`Creating GitHub release ${v}...`);
// Hand-written notes (docs/releases/<version>.md) win over generated ones.
const notesFile = resolve(root, 'docs', 'releases', `${pkg.version}.md`);
const notes = existsSync(notesFile) ? `--notes-file "${notesFile}"` : '--generate-notes';
run(`gh release create "${v}" ${notes} --title "${v}"`);
console.log(`\nDone. https://github.com/PabloVitasso/szkrabok/releases/tag/${v}`);
