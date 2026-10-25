#!/usr/bin/env node
// verify-playwright-patches.js
// Runs after patch-package to confirm all playwright-core patches applied cleanly.
// Exits 1 (hard failure) if any marker is missing.
// Marker list: packages/runtime/patch-check.js (shared with doctor and launch()).

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { PATCH_FILE, PATCH_MARKERS, missingPatchMarkers } from '../packages/runtime/patch-check.js'

const require = createRequire(import.meta.url)

let pwRoot
try {
  pwRoot = join(require.resolve('playwright-core/package.json'), '..')
} catch {
  console.error('[verify-patches] ERROR: playwright-core not found in node_modules')
  process.exit(1)
}

const pwVersion = JSON.parse(readFileSync(join(pwRoot, 'package.json'), 'utf8')).version
console.log(`\n[verify-patches] Checking playwright-core@${pwVersion} patches ...`)

// null = file unreadable: every marker counts as missing.
const missing = missingPatchMarkers(pwRoot) ?? PATCH_MARKERS
for (const marker of PATCH_MARKERS) {
  const status = missing.includes(marker) ? 'FAIL' : 'PASS'
  console.log(`  ${status} ${PATCH_FILE} — ${marker}`)
}

if (missing.length > 0) {
  console.error('[verify-patches] FAILED — one or more patches are missing.')
  console.error('  patch-package did not apply cleanly for playwright-core@' + pwVersion)
  console.error('  To update the patch for a new playwright version, see: docs/development.md#upgrading-playwright-core\n')
  process.exit(1)
}

console.log('[verify-patches] All patches present.\n')
