#!/usr/bin/env node
// verify-playwright-patches.js
// Runs after patch-package to confirm all playwright-core patches applied cleanly.
// Exits 1 (hard failure) if any marker is missing.

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'

const require = createRequire(import.meta.url)

const PATCHES = [
  { file: 'lib/server/chromium/crConnection.js',   marker: '__re__emitExecutionContext' },
  { file: 'lib/server/chromium/crDevTools.js',      marker: 'REBROWSER_PATCHES_RUNTIME_FIX_MODE' },
  { file: 'lib/server/chromium/crPage.js',          marker: 'szkrabok: greasy brands' },
  { file: 'lib/server/chromium/crServiceWorker.js', marker: 'REBROWSER_PATCHES_RUNTIME_FIX_MODE' },
  { file: 'lib/server/frames.js',                   marker: '__re__emitExecutionContext' },
  { file: 'lib/server/page.js',                     marker: 'getExecutionContext' },
  { file: 'lib/generated/utilityScriptSource.js',   marker: 'var __pwUs = class' },
]

let pwRoot
try {
  pwRoot = join(require.resolve('playwright-core/package.json'), '..')
} catch {
  console.error('[verify-patches] ERROR: playwright-core not found in node_modules')
  process.exit(1)
}

const pwVersion = JSON.parse(readFileSync(join(pwRoot, 'package.json'), 'utf8')).version
console.log(`\n[verify-patches] Checking playwright-core@${pwVersion} patches ...`)

let allOk = true
for (const { file, marker } of PATCHES) {
  let ok = false
  try {
    ok = readFileSync(join(pwRoot, file), 'utf8').includes(marker)
  } catch {
    ok = false
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${file}`)
  if (!ok) allOk = false
}

if (allOk) {
  console.log('[verify-patches] All patches present.\n')
} else {
  console.error('[verify-patches] FAILED — one or more patches are missing.')
  console.error('  patch-package did not apply cleanly for playwright-core@' + pwVersion)
  console.error('  To update the patch for a new playwright version, see: docs/upgrading-playwright.md\n')
  process.exit(1)
}
