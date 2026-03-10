import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const v = pkg.version;

const run = cmd => execSync(cmd, { cwd: root, stdio: 'inherit' });

// Stage all version-bumped files
run('git add package.json package-lock.json packages/runtime/package.json');

// Single release commit
run(`git commit -m "chore: release ${v}"`);

// Tag on this commit (not the npm version bump commit)
run(`git tag v${v}`);

// Push commit and tag together
run('git push');
run(`git push origin v${v}`);

console.log(`\nReleased v${v}. Run: npm run release:publish`);
