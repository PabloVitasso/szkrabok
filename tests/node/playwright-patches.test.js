// Verifies that all playwright-core patches are applied in node_modules.
// Fails loudly if the patch script did not apply cleanly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'

const require = createRequire(import.meta.url)

// Since playwright-core 1.60.0 all server source is bundled into coreBundle.js.
const PATCHES = [
  { file: 'lib/coreBundle.js', marker: '__re__emitExecutionContext' },
  { file: 'lib/coreBundle.js', marker: 'szkrabok: greasy brands'   },
  { file: 'lib/coreBundle.js', marker: 'getExecutionContext'        },
  { file: 'lib/coreBundle.js', marker: 'var __pwUs = class'         },
  { file: 'lib/coreBundle.js', marker: 'REBROWSER_PATCHES_RUNTIME_FIX_MODE' },
]

const pwRoot = join(require.resolve('playwright-core/package.json'), '..')

for (const { file, marker } of PATCHES) {
  test(`playwright-core patch applied: lib/coreBundle.js — ${marker}`, () => {
    const content = readFileSync(join(pwRoot, file), 'utf8')
    assert.ok(
      content.includes(marker),
      `Missing patch marker "${marker}" in ${file} — run: node packages/runtime/scripts/patch-playwright.js`
    )
  })
}
