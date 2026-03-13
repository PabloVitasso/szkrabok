// Verifies that all playwright-core patches are applied in node_modules.
// Fails loudly if patch-package did not apply the patch correctly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
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

const pwRoot = join(require.resolve('playwright-core/package.json'), '..')

for (const { file, marker } of PATCHES) {
  test(`playwright-core patch applied: ${file}`, () => {
    const content = readFileSync(join(pwRoot, file), 'utf8')
    assert.ok(
      content.includes(marker),
      `Missing patch marker "${marker}" in ${file} — run: npm install`
    )
  })
}
