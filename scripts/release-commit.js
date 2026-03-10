import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'));

execSync(
  `git add package.json package-lock.json packages/runtime/package.json && git commit -m "chore: release ${pkg.version}"`,
  { stdio: 'inherit' }
);
