import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const v = pkg.version;

const run = cmd => execSync(cmd, { cwd: root, stdio: 'inherit' });

try {
  execSync('npm whoami', { stdio: 'pipe' });
} catch {
  console.error('ERROR: not logged in to npm. Run: npm login');
  process.exit(1);
}

console.log(`Publishing @pablovitasso/szkrabok@${v} to npm...`);
run('npm publish --access public');
console.log(`\nDone. https://www.npmjs.com/package/@pablovitasso/szkrabok`);
