import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'));
const v = pkg.version;

console.log(`
Pack complete: dist/szkrabok-runtime-${v}.tgz

Next steps:
  1. npm run release:publish
  2. Update RUNTIME_RELEASES in src/tools/scaffold.js  (add '${v}' entry, bump CURRENT_RUNTIME_VERSION)
`);
