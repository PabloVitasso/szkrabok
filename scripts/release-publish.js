import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'));
const v = pkg.version;
const tarball = `dist/szkrabok-runtime-${v}.tgz`;

try {
  execSync(`gh auth status`, { stdio: 'pipe' });
} catch {
  console.error('ERROR: gh auth failed. Run: gh auth login');
  process.exit(1);
}

console.log(`Creating GitHub release v${v} and uploading ${tarball}...`);
execSync(`gh release create v${v} ${tarball} --repo PabloVitasso/szkrabok --title v${v}`, { stdio: 'inherit' });
console.log(`\nDone. Remember to update RUNTIME_RELEASES in src/tools/scaffold.js.`);
