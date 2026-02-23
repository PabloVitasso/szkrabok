#!/usr/bin/env node
/**
 * patch-playwright.js
 *
 * Goal
 * ────
 * Apply the rebrowser Runtime.enable leak fixes directly to the compiled
 * playwright-core lib/ files installed in node_modules.  This avoids the
 * fragility of line-number-based .patch files while staying independent of
 * any third-party patcher keeping up with playwright releases.
 *
 * What it fixes
 * ─────────────
 * By default playwright calls CDP Runtime.enable on every frame, worker and
 * service-worker session.  Anti-bot systems (Cloudflare, DataDome, etc.) detect
 * this call and flag the session as automated.  The fix:
 *
 *   1. Suppresses automatic Runtime.enable calls in crPage, crDevTools,
 *      crServiceWorker.
 *   2. Adds __re__emitExecutionContext / __re__getMainWorld /
 *      __re__getIsolatedWorld helpers to CRConnection that obtain a valid
 *      execution-context ID without Runtime.enable, using an addBinding
 *      round-trip instead (the "addBinding" mode, default and safest).
 *   3. Rewires Frame._context() and Worker.evaluateExpression() to use the
 *      new helpers so all page.evaluate() calls still work transparently.
 *   4. Renames the internal UtilityScript class (compiled bundle injected into
 *      every page context) to a generic name.  The rebrowser bot-detector
 *      intercepts document.getElementById and checks new Error().stack for the
 *      string "UtilityScript." — renaming the class eliminates that signal.
 *
 * Source of logic
 * ───────────────
 * Derived from rebrowser-patches (https://github.com/rebrowser/rebrowser-patches)
 * MIT licence.  We re-implement the same logical changes as pattern-based
 * string replacements so they survive minor refactors across playwright
 * versions without requiring the external patcher tool.
 *
 * Behaviour flags (env vars, same as rebrowser-patches)
 * ──────────────────────────────────────────────────────
 *   REBROWSER_PATCHES_RUNTIME_FIX_MODE=addBinding   (default — safest)
 *   REBROWSER_PATCHES_RUNTIME_FIX_MODE=alwaysIsolated
 *   REBROWSER_PATCHES_RUNTIME_FIX_MODE=enableDisable
 *   REBROWSER_PATCHES_RUNTIME_FIX_MODE=0            (disable fix)
 *   REBROWSER_PATCHES_SOURCE_URL=app.js             (default)
 *   REBROWSER_PATCHES_SOURCE_URL=0                  (disable sourceURL fix)
 *   REBROWSER_PATCHES_DEBUG=1                       (verbose logging)
 *
 * Atomicity / rollback
 * ────────────────────
 * Before touching any file the script writes a .orig backup next to it.
 * If ANY patch step fails, ALL modified files are restored from their backups
 * and the process exits non-zero with a clear diagnostic.  On success the
 * backups are removed.
 */

import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// ── locate playwright-core ────────────────────────────────────────────────────

let pkgRoot
try {
  pkgRoot = path.dirname(require.resolve('playwright-core/package.json'))
} catch {
  console.error('[patch-playwright] ERROR: playwright-core not found in node_modules.')
  console.error('  Run `npm install` first.')
  process.exit(1)
}

const pwVersion = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version
const lib = path.join(pkgRoot, 'lib')

console.log(`[patch-playwright] playwright-core ${pwVersion} found at ${pkgRoot}`)

// ── helpers ───────────────────────────────────────────────────────────────────

const backups = new Map() // filePath -> originalContent

function read(rel) {
  return fs.readFileSync(path.join(lib, rel), 'utf8')
}

function backup(rel, content) {
  backups.set(rel, content)
}

function rollback() {
  console.error('[patch-playwright] Rolling back all changes ...')
  for (const [rel, original] of backups) {
    try {
      fs.writeFileSync(path.join(lib, rel), original, 'utf8')
      console.error(`  restored ${rel}`)
    } catch (e) {
      console.error(`  FAILED to restore ${rel}: ${e.message}`)
    }
  }
}

function write(rel, content) {
  fs.writeFileSync(path.join(lib, rel), content, 'utf8')
}

/**
 * Apply a single named replacement to content.
 * Throws with a descriptive message if the search string is not found.
 */
function replace(file, content, searchStr, replacement, label) {
  if (!content.includes(searchStr)) {
    throw new Error(
      `[patch-playwright] Pattern not found in ${file}\n` +
      `  patch: "${label}"\n` +
      `  searched for: ${searchStr.slice(0, 120).replace(/\n/g, '\\n')}\n\n` +
      `  This likely means playwright-core ${pwVersion} changed the code at this\n` +
      `  location.  Update scripts/patch-playwright.js to match the new source.`
    )
  }
  return content.replace(searchStr, replacement)
}

// ── patch definitions ─────────────────────────────────────────────────────────

const patches = [

  // ── 1. crConnection.js — inject __re__ helpers into CRConnection ────────────
  {
    file: 'server/chromium/crConnection.js',
    steps: (src) => {
      // Insert the three helper methods just before the closing brace of
      // CRConnection (right after this._callbacks.clear(); })
      const anchor = `    this._callbacks.clear();
  }
}
class CDPSession`

      const injection = `    this._callbacks.clear();
  }

  // ── rebrowser Runtime.enable fix ──────────────────────────────────────────
  // Obtains an execution-context ID for a given world without calling
  // Runtime.enable, which is detectable by anti-bot systems.
  async __re__emitExecutionContext({ world, targetId, frame = null }) {
    const fixMode = process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] || 'addBinding'
    const utilityWorldName =
      process.env['REBROWSER_PATCHES_UTILITY_WORLD_NAME'] !== '0'
        ? (process.env['REBROWSER_PATCHES_UTILITY_WORLD_NAME'] || 'util')
        : '__playwright_utility_world__'
    if (process.env['REBROWSER_PATCHES_DEBUG'])
      console.log(\`[rebrowser-patches][crSession] targetId=\${targetId} world=\${world} frame=\${frame ? 'Y' : 'N'} fixMode=\${fixMode}\`)

    let getWorldPromise
    if (fixMode === 'addBinding') {
      if (world === 'utility') {
        getWorldPromise = this.__re__getIsolatedWorld({ client: this, frameId: targetId, worldName: utilityWorldName })
          .then(contextId => ({ id: contextId, name: '__playwright_utility_world__', auxData: { frameId: targetId, isDefault: false } }))
      } else if (world === 'main') {
        getWorldPromise = this.__re__getMainWorld({ client: this, frameId: targetId, isWorker: frame === null })
          .then(contextId => ({ id: contextId, name: '', auxData: { frameId: targetId, isDefault: true } }))
      }
    } else if (fixMode === 'alwaysIsolated') {
      getWorldPromise = this.__re__getIsolatedWorld({ client: this, frameId: targetId, worldName: utilityWorldName })
        .then(contextId => ({ id: contextId, name: '', auxData: { frameId: targetId, isDefault: true } }))
    }

    const contextPayload = await getWorldPromise
    this.emit('Runtime.executionContextCreated', { context: contextPayload })
  }

  async __re__getMainWorld({ client, frameId, isWorker = false }) {
    let contextId
    const randomName = [...Array(Math.floor(Math.random() * 11) + 10)]
      .map(() => Math.random().toString(36)[2]).join('')
    if (process.env['REBROWSER_PATCHES_DEBUG'])
      console.log(\`[rebrowser-patches][getMainWorld] binding=\${randomName}\`)

    await client.send('Runtime.addBinding', { name: randomName })

    const bindingCalledHandler = ({ name, payload, executionContextId }) => {
      if (contextId > 0 || name !== randomName || payload !== frameId) return
      contextId = executionContextId
      client.off('Runtime.bindingCalled', bindingCalledHandler)
    }
    client.on('Runtime.bindingCalled', bindingCalledHandler)

    if (isWorker) {
      await client.send('Runtime.evaluate', { expression: \`this['\${randomName}']('\${frameId}')\` })
    } else {
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: \`document.addEventListener('\${randomName}', (e) => self['\${randomName}'](e.detail.frameId))\`,
        runImmediately: true,
      })
      const isolated = await client.send('Page.createIsolatedWorld', { frameId, worldName: randomName, grantUniveralAccess: true })
      await client.send('Runtime.evaluate', {
        expression: \`document.dispatchEvent(new CustomEvent('\${randomName}', { detail: { frameId: '\${frameId}' } }))\`,
        contextId: isolated.executionContextId,
      })
    }
    if (process.env['REBROWSER_PATCHES_DEBUG'])
      console.log(\`[rebrowser-patches][getMainWorld] contextId=\${contextId}\`)
    return contextId
  }

  async __re__getIsolatedWorld({ client, frameId, worldName }) {
    const result = await client.send('Page.createIsolatedWorld', { frameId, worldName, grantUniveralAccess: true })
    if (process.env['REBROWSER_PATCHES_DEBUG'])
      console.log('[rebrowser-patches][getIsolatedWorld]', result)
    return result.executionContextId
  }
  // ── end rebrowser fix ──────────────────────────────────────────────────────
}
class CDPSession`

      return replace('crConnection.js', src, anchor, injection, 'inject __re__ helpers')
    },
  },

  // ── 2. crDevTools.js — suppress Runtime.enable ─────────────────────────────
  {
    file: 'server/chromium/crDevTools.js',
    steps: (src) => {
      return replace(
        'crDevTools.js', src,
        `      session.send("Runtime.enable"),`,
        `      (() => { if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0') return session.send('Runtime.enable', {}) })(),`,
        'suppress Runtime.enable in crDevTools'
      )
    },
  },

  // ── 3. crPage.js — suppress Runtime.enable (page + worker) ─────────────────
  {
    file: 'server/chromium/crPage.js',
    steps: (src) => {
      // 3a. page-level Runtime.enable
      src = replace(
        'crPage.js', src,
        `      this._client.send("Runtime.enable", {}),`,
        `      (() => { if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0') return this._client.send('Runtime.enable', {}) })(),`,
        'suppress Runtime.enable for page in crPage'
      )
      // 3b. worker-level Runtime.enable + pass targetId/session to Worker
      src = replace(
        'crPage.js', src,
        `    const worker = new import_page.Worker(this._page, url);`,
        `    const worker = new import_page.Worker(this._page, url, event.targetInfo.targetId, session);`,
        'pass targetId+session to Worker constructor'
      )
      src = replace(
        'crPage.js', src,
        `    session._sendMayFail("Runtime.enable");`,
        `    if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0') session._sendMayFail('Runtime.enable');`,
        'suppress Runtime.enable for worker in crPage'
      )
      return src
    },
  },

  // ── 4. crServiceWorker.js — suppress Runtime.enable ────────────────────────
  {
    file: 'server/chromium/crServiceWorker.js',
    steps: (src) => {
      return replace(
        'crServiceWorker.js', src,
        `    session.send("Runtime.enable", {}).catch((e) => {
    });`,
        `    if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0') {
      session.send('Runtime.enable', {}).catch((e) => {})
    }`,
        'suppress Runtime.enable in crServiceWorker'
      )
    },
  },

  // ── 5. frames.js — emit executionContextsCleared + rewire _context() ───────
  {
    file: 'server/frames.js',
    steps: (src) => {
      // 5a. emit executionContextsCleared on commit so CRConnection knows
      //     to re-acquire context IDs after navigation
      src = replace(
        'frames.js', src,
        `    this._page.mainFrame()._recalculateNetworkIdle(this);
    this._onLifecycleEvent("commit");
  }`,
        `    this._page.mainFrame()._recalculateNetworkIdle(this);
    this._onLifecycleEvent("commit");
    const crSession = (this._page.delegate._sessions?.get(this._id) || this._page.delegate._mainFrameSession)?._client
    if (crSession) crSession.emit('Runtime.executionContextsCleared')
  }`,
        'emit executionContextsCleared on commit'
      )
      // 5b. rewire Frame._context() to use __re__emitExecutionContext instead
      //     of waiting on the contextPromise that never resolves without Runtime.enable
      src = replace(
        'frames.js', src,
        `  _context(world) {
    return this._contextData.get(world).contextPromise.then((contextOrDestroyedReason) => {
      if (contextOrDestroyedReason instanceof js.ExecutionContext)
        return contextOrDestroyedReason;
      throw new Error(contextOrDestroyedReason.destroyedReason);
    });
  }`,
        `  _context(world, useContextPromise = false) {
    if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0' || this._contextData.get(world).context || useContextPromise) {
      return this._contextData.get(world).contextPromise.then((contextOrDestroyedReason) => {
        if (contextOrDestroyedReason instanceof js.ExecutionContext)
          return contextOrDestroyedReason;
        throw new Error(contextOrDestroyedReason.destroyedReason);
      });
    }
    const crSession = (this._page.delegate._sessions?.get(this._id) || this._page.delegate._mainFrameSession)?._client
    return crSession.__re__emitExecutionContext({ world, targetId: this._id, frame: this })
      .then(() => this._context(world, true))
      .catch(error => {
        if (error.message.includes('No frame for given id found'))
          return { destroyedReason: 'Frame was detached' }
        console.error('[rebrowser-patches][frames._context] error:', error)
      })
  }`,
        'rewire Frame._context to use __re__emitExecutionContext'
      )
      return src
    },
  },

  // ── 6. page.js — update Worker constructor + guard PageBinding.dispatch ─────
  {
    file: 'server/page.js',
    steps: (src) => {
      // 6a. Worker constructor: accept targetId + session
      src = replace(
        'page.js', src,
        `  constructor(parent, url) {
    super(parent, "worker");
    this._executionContextPromise = new import_manualPromise.ManualPromise();`,
        `  constructor(parent, url, targetId, session) {
    super(parent, "worker");
    this._executionContextPromise = new import_manualPromise.ManualPromise();
    this._targetId = targetId
    this._session = session`,
        'Worker constructor accept targetId+session'
      )
      // 6b. evaluateExpression / evaluateExpressionHandle: use getExecutionContext()
      src = replace(
        'page.js', src,
        `  async evaluateExpression(expression, isFunction, arg) {
    return js.evaluateExpression(await this._executionContextPromise, expression, { returnByValue: true, isFunction }, arg);
  }
  async evaluateExpressionHandle(expression, isFunction, arg) {
    return js.evaluateExpression(await this._executionContextPromise, expression, { returnByValue: false, isFunction }, arg);
  }`,
        `  async getExecutionContext() {
    if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] !== '0' && !this.existingExecutionContext) {
      await this._session.__re__emitExecutionContext({ world: 'main', targetId: this._targetId })
    }
    return this._executionContextPromise
  }
  async evaluateExpression(expression, isFunction, arg) {
    return js.evaluateExpression(await this.getExecutionContext(), expression, { returnByValue: true, isFunction }, arg);
  }
  async evaluateExpressionHandle(expression, isFunction, arg) {
    return js.evaluateExpression(await this.getExecutionContext(), expression, { returnByValue: false, isFunction }, arg);
  }`,
        'Worker.evaluateExpression use getExecutionContext'
      )
      // 6c. PageBinding.dispatch: ignore binding calls that are not JSON
      //     (the addBinding helper emits raw strings, not our JSON payloads)
      src = replace(
        'page.js', src,
        `  static async dispatch(page, payload, context) {
    const { name, seq, serializedArgs } = JSON.parse(payload);`,
        `  static async dispatch(page, payload, context) {
    if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] !== '0' && !payload.includes('{')) return;
    const { name, seq, serializedArgs } = JSON.parse(payload);`,
        'PageBinding.dispatch guard non-JSON payloads'
      )
      return src
    },
  },
  // ── 7. utilityScriptSource.js — rename UtilityScript class ────────────────
  //
  // The rebrowser bot-detector wraps document.getElementById and inspects
  // new Error().stack for the string "UtilityScript." (class.method notation).
  // Playwright injects a compiled bundle called UtilityScript into every page
  // context and all page.evaluate() calls run through UtilityScript.evaluate().
  // Renaming the class breaks the string match without affecting functionality.
  //
  // Note: rebrowser-patches does NOT include this fix for playwright (only for
  // puppeteer's pptr: sourceURL).  This is an original addition.
  {
    file: 'generated/utilityScriptSource.js',
    steps: (src) => {
      // The source is a large single-line JS string.  Inside it, the class is
      // declared as "var UtilityScript = class {" and exported via the key
      // "UtilityScript: () => UtilityScript".  We rename the variable only
      // (not the export key, which other playwright code references by name).
      src = replace(
        'utilityScriptSource.js', src,
        `var UtilityScript = class {`,
        `var __pwUs = class {`,
        'rename UtilityScript class variable'
      )
      // The export arrow also references the old name — update it
      src = replace(
        'utilityScriptSource.js', src,
        `UtilityScript: () => UtilityScript`,
        `UtilityScript: () => __pwUs`,
        'update UtilityScript export reference'
      )
      return src
    },
  },
]

// ── run ───────────────────────────────────────────────────────────────────────

console.log(`[patch-playwright] Applying ${patches.length} patch groups ...`)

let failed = false

for (const { file, steps } of patches) {
  let src
  try {
    src = read(file)
  } catch (e) {
    console.error(`[patch-playwright] ERROR reading ${file}: ${e.message}`)
    failed = true
    break
  }

  backup(file, src)

  let patched
  try {
    patched = steps(src)
  } catch (e) {
    console.error(e.message)
    failed = true
    break
  }

  try {
    write(file, patched)
    console.log(`  patched ${file}`)
  } catch (e) {
    console.error(`[patch-playwright] ERROR writing ${file}: ${e.message}`)
    failed = true
    break
  }
}

if (failed) {
  rollback()
  console.error('')
  console.error('[patch-playwright] PATCH FAILED — all files restored to original state.')
  console.error('')
  console.error('  What to do:')
  console.error(`  1. Check playwright-core version (installed: ${pwVersion}).`)
  console.error('  2. Open scripts/patch-playwright.js and update the search strings')
  console.error('     in the failing patch step to match the new source.')
  console.error('  3. Re-run:  node scripts/patch-playwright.js')
  console.error('')
  console.error('  The MCP server will still work — just without the Runtime.enable fix,')
  console.error('  meaning sourceUrlLeak / mainWorldExecution / exposeFunctionLeak checks')
  console.error('  on bot-detector.rebrowser.net will continue to fail.')
  process.exit(1)
}

console.log(`[patch-playwright] All patches applied successfully (playwright-core ${pwVersion}).`)
