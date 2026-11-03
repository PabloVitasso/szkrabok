#!/usr/bin/env node
// apply-greasy-brands.js — postinstall: szkrabok's greasy-brands block in the
// playwright-core that `playwright` loads (packages/runtime/greasy-brands-patch.js).
//
//   --strip  remove the block; runs before apply-patches.js, because
//            patch-package hunks are line-position based
//   default  inject the current block (replaces one of another rev)
//
// Independent of the rebrowser patches: works on stock, patched or drop-in cores.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATCH_FILE, playwrightCoreRoot } from '../packages/runtime/patch-check.js';
import { injectGreasyBrands, stripGreasyBrands } from '../packages/runtime/greasy-brands-patch.js';

const strip = process.argv.includes('--strip');
const pwRoot = playwrightCoreRoot();
if (!pwRoot) {
  console.error('[greasy-brands] ERROR: playwright-core not found');
  process.exit(1);
}

const file = join(pwRoot, PATCH_FILE);
let src;
let out;
try {
  src = readFileSync(file, 'utf8');
  out = strip ? stripGreasyBrands(src) : injectGreasyBrands(src);
} catch (e) {
  console.error(`[greasy-brands] ERROR in ${file}: ${e.message}`);
  process.exit(1);
}
if (out !== src) writeFileSync(file, out);
console.log(
  `[greasy-brands] ${strip ? 'stripped' : 'injected'}: ${file}${out === src ? ' (unchanged)' : ''}`
);
