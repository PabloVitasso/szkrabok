#!/usr/bin/env node
/**
 * patch-playwright.js
 *
 * ── Goal ──────────────────────────────────────────────────────────────────────
 * Apply anti-bot detection fixes directly to compiled playwright-core lib/
 * files in node_modules.  Pattern-based string replacement — more resilient
 * than line-number .patch files, independent of any third-party patcher.
 *
 * ── What it fixes ─────────────────────────────────────────────────────────────
 *
 * FIX A — Runtime.enable CDP leak (patches #2 #3 #4 #5 #6)
 *   Playwright calls CDP Runtime.enable on every frame/worker/service-worker.
 *   Anti-bot systems (Cloudflare, DataDome) detect this and flag the session.
 *   Fix: suppress Runtime.enable; obtain execution-context IDs on-demand via
 *   an addBinding round-trip (__re__getMainWorld) or Page.createIsolatedWorld
 *   (__re__getIsolatedWorld) instead.
 *
 * FIX B — sourceUrlLeak (patch #7)
 *   (see inline comment)
 *
 * FIX C — userAgentData brands (patch #8)
 *   The rebrowser bot-detector overrides document.getElementById and inspects
 *   new Error().stack for the string "UtilityScript." (class.method notation).
 *   Playwright injects a compiled bundle with class UtilityScript into every
 *   page context; all page.evaluate() calls run through UtilityScript.evaluate().
 *   Fix: rename the class to __pwUs inside the compiled bundle. The export key
 *   "UtilityScript" stays unchanged so internal playwright code is unaffected.
 *   NOTE: rebrowser-patches does NOT include this fix for playwright (only for
 *   puppeteer). This is an original szkrabok addition.
 *
 * ── The utility-world name bug and waitForSelector fix ─────────────────────────
 *   After suppressing Runtime.enable, playwright never receives automatic
 *   Runtime.executionContextCreated events.  We emit them manually from
 *   __re__emitExecutionContext.  The emitted contextPayload must include the
 *   exact utility world name that crPage.js checks when registering a context:
 *
 *     crPage.js: this.utilityWorldName = `__playwright_utility_world_${this._page.guid}`
 *     crPage.js: if (contextPayload.name === this._crPage.utilityWorldName) worldName = "utility"
 *
 *   The name is per-page (includes a GUID) and CANNOT be hardcoded.
 *   We pass it explicitly from frames.js patch #5b, where the frame has
 *   access to this._page.delegate.utilityWorldName (the CRPage instance).
 *   crConnection.js receives it as `callerUtilityWorldName` — it stays
 *   decoupled from CRPage internals so only frames.js needs updating if the
 *   property moves upstream.
 *   Without this fix: waitForSelector / locators / page.click all hang forever
 *   because the utility world context is never registered.
 *
 * ── Multiple playwright-core installs ─────────────────────────────────────────
 *   npm may install playwright-core in two locations:
 *     node_modules/playwright-core              — used by the MCP server
 *     node_modules/playwright/node_modules/playwright-core — used by the
 *       test runner (browser.run_test spawns `npx playwright test` which
 *       resolves playwright-core through its own nested copy)
 *   Both must be patched. This script finds and patches all copies.
 *   Each patched install gets a `.szkrabok-patched` stamp file next to
 *   package.json so patches are visible at a glance.
 *   To re-patch after a version bump: rm -rf both dirs, npm install, re-run.
 *
 * ── Upstream merge survival ────────────────────────────────────────────────────
 *   Each patch uses a search string anchored to a stable code pattern.
 *   When a patch fails (pattern not found), update the search string to match
 *   the new compiled source and re-run. Per-patch fragility notes are inline.
 *   Key things to re-verify after any playwright-core version bump:
 *     - crPage.js still has `utilityWorldName` property (used by patch #5b)
 *     - crPage.js still matches context by name === utilityWorldName (patch #1)
 *     - Worker constructor signature (patches #3b, #6a)
 *     - PageBinding.dispatch still parses JSON payload (patch #6c)
 *   Reference: vendor/rebrowser-patches/patches/playwright-core/src.patch
 *   Reference: docs/rebrowser-patches-research.md
 *   Reference: docs/waitForSelector-bug.md
 *
 * ── Source of logic ───────────────────────────────────────────────────────────
 *   Derived from rebrowser-patches (https://github.com/rebrowser/rebrowser-patches)
 *   MIT licence. We re-implement as pattern-based replacements.
 *   Reference copy: vendor/rebrowser-patches/ (gitignored, update with git pull)
 *
 * ── Behaviour flags (env vars, same as rebrowser-patches) ─────────────────────
 *   REBROWSER_PATCHES_RUNTIME_FIX_MODE=addBinding   (default — safest)
 *   REBROWSER_PATCHES_RUNTIME_FIX_MODE=alwaysIsolated
 *   REBROWSER_PATCHES_RUNTIME_FIX_MODE=enableDisable
 *   REBROWSER_PATCHES_RUNTIME_FIX_MODE=0            (disable all fixes)
 *   REBROWSER_PATCHES_DEBUG=1                       (verbose logging)
 *
 * ── Atomicity / rollback ──────────────────────────────────────────────────────
 *   Before touching any file the script writes <file>.bak to disk.
 *   If ANY patch step fails, all modified files for that install are restored
 *   from .bak and the process exits non-zero with a diagnostic.
 *   On success .bak files are deleted.
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// ── locate all playwright-core installs ───────────────────────────────────────
// npm hoists one copy to node_modules/playwright-core but playwright itself
// may carry its own nested copy at node_modules/playwright/node_modules/playwright-core.
// Both must be patched — the MCP server uses the hoisted one, the test runner
// (spawned by browser.run_test) uses whichever playwright/test resolves.

function findPkgRoots() {
  const roots = []
  const nmDir = path.resolve('node_modules')

  // 1. top-level playwright-core
  const top = path.join(nmDir, 'playwright-core')
  if (fs.existsSync(path.join(top, 'package.json'))) roots.push(top)

  // 2. any nested playwright-core inside other packages
  try {
    const out = execSync(
      'find node_modules -maxdepth 4 -name "package.json" -path "*/playwright-core/package.json" 2>/dev/null',
      { encoding: 'utf8' }
    )
    for (const line of out.trim().split('\n')) {
      if (!line) continue
      const dir = path.dirname(path.resolve(line))
      if (!roots.includes(dir)) roots.push(dir)
    }
  } catch {}

  return roots
}

const pkgRoots = findPkgRoots()
if (!pkgRoots.length) {
  console.error('[patch-playwright] ERROR: playwright-core not found in node_modules.')
  console.error('  Run `npm install` first.')
  process.exit(1)
}

// ── helpers ───────────────────────────────────────────────────────────────────
// (read/write/backup/rollback/removeBaks are defined per-install inside the run loop)

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
        `  Update the search string in scripts/patch-playwright.js to match the new source.\n` +
        `  Reference: vendor/rebrowser-patches/patches/playwright-core/src.patch`
    )
  }
  return content.replace(searchStr, replacement)
}

// ── patch definitions ─────────────────────────────────────────────────────────

const patches = [
  // ── 1. crConnection.js — inject __re__ helpers into CRSession ────────────────
  // Adds three methods to CRSession (the CDP session class):
  //   __re__emitExecutionContext  — top-level coordinator; emits the
  //     Runtime.executionContextCreated event that playwright needs
  //   __re__getMainWorld          — gets the main-world context ID via
  //     Runtime.addBinding round-trip (avoids Runtime.enable)
  //   __re__getIsolatedWorld      — gets an isolated-world context ID via
  //     Page.createIsolatedWorld
  //
  // KEY DESIGN: callerUtilityWorldName is passed in from frames.js (patch #5b)
  // rather than derived here from frame._page.delegate.utilityWorldName.
  // Reason: crConnection.js should not know CRPage internals. If the property
  // moves upstream, only frames.js patch #5b needs updating.
  //
  // UPSTREAM FRAGILITY:
  //   Anchor: end of CRSession class (this._callbacks.clear()) + start of
  //   CDPSession class. Stable — class boundaries rarely move.
  //   If it breaks: find the end of CRSession.dispose() and start of CDPSession.
  {
    file: 'server/chromium/crConnection.js',
    steps: src => {
      // Insert the three helper methods just before the closing brace of
      // CRSession (right after this._callbacks.clear(); })
      const anchor = `    this._callbacks.clear();
  }
}
class CDPSession`

      const injection = `    this._callbacks.clear();
  }

  // ── rebrowser Runtime.enable fix ──────────────────────────────────────────
  // Obtains an execution-context ID for a given world without calling
  // Runtime.enable, which is detectable by anti-bot systems.
  async __re__emitExecutionContext({ world, targetId, frame = null, utilityWorldName: callerUtilityWorldName }) {
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
          .then(contextId => ({ id: contextId, name: callerUtilityWorldName || '__playwright_utility_world__', auxData: { frameId: targetId, isDefault: false } }))
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

  // ── 2. crDevTools.js — suppress Runtime.enable ────────────────────────────────
  // crDevTools.js enables the runtime for DevTools protocol sessions.
  // UPSTREAM FRAGILITY: anchor is the literal `session.send("Runtime.enable"),`
  // inside a Promise.all([...]). If the surrounding code is refactored or
  // the Promise.all is removed, update the search string.
  {
    file: 'server/chromium/crDevTools.js',
    steps: src => {
      return replace(
        'crDevTools.js',
        src,
        `      session.send("Runtime.enable"),`,
        `      (() => { if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0') return session.send('Runtime.enable', {}) })(),`,
        'suppress Runtime.enable in crDevTools'
      )
    },
  },

  // ── 3. crPage.js — suppress Runtime.enable (page + worker) ───────────────────
  // Three changes:
  //   3a. Suppress page-level Runtime.enable in the session setup Promise.all
  //   3b. Pass targetId + session to the Worker constructor (needed by patch #6)
  //   3c. Suppress worker-level Runtime.enable
  // UPSTREAM FRAGILITY:
  //   3a: anchor is `this._client.send("Runtime.enable", {})` inside Promise.all
  //   3b: anchor is `new import_page.Worker(this._page, url)` — if the Worker
  //       constructor gains/loses args upstream, both this line AND patch #6a
  //       must be updated together
  //   3c: anchor is `session._sendMayFail("Runtime.enable")` in the worker handler
  {
    file: 'server/chromium/crPage.js',
    steps: src => {
      // 3a. page-level Runtime.enable
      src = replace(
        'crPage.js',
        src,
        `      this._client.send("Runtime.enable", {}),`,
        `      (() => { if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0') return this._client.send('Runtime.enable', {}) })(),`,
        'suppress Runtime.enable for page in crPage'
      )
      // 3b. worker-level Runtime.enable + pass targetId/session to Worker
      src = replace(
        'crPage.js',
        src,
        `    const worker = new import_page.Worker(this._page, url);`,
        `    const worker = new import_page.Worker(this._page, url, event.targetInfo.targetId, session);`,
        'pass targetId+session to Worker constructor'
      )
      src = replace(
        'crPage.js',
        src,
        `    session._sendMayFail("Runtime.enable");`,
        `    if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0') session._sendMayFail('Runtime.enable');`,
        'suppress Runtime.enable for worker in crPage'
      )
      return src
    },
  },

  // ── 4. crServiceWorker.js — suppress Runtime.enable ──────────────────────────
  // UPSTREAM FRAGILITY: anchor includes the .catch((e) => {}) pattern.
  // If the catch block changes (e.g. adds a log line), update both lines.
  {
    file: 'server/chromium/crServiceWorker.js',
    steps: src => {
      return replace(
        'crServiceWorker.js',
        src,
        `    session.send("Runtime.enable", {}).catch((e) => {
    });`,
        `    if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0') {
      session.send('Runtime.enable', {}).catch((e) => {})
    }`,
        'suppress Runtime.enable in crServiceWorker'
      )
    },
  },

  // ── 5. frames.js — emit executionContextsCleared + rewire _context() ─────────
  // Two changes:
  //   5a. After each frame commit (navigation), emit executionContextsCleared on
  //       the CRSession so existing context IDs are invalidated and re-acquired
  //       on next use. Without this, stale context IDs from before navigation
  //       are used and evaluate() calls fail silently.
  //   5b. Rewire Frame._context() to lazily call __re__emitExecutionContext when
  //       the context hasn't been established yet (which is always, since we
  //       suppressed Runtime.enable in patches #2-#4).
  //
  //       CRITICAL — utilityWorldName passing:
  //       This patch passes `this._page.delegate?.utilityWorldName` to
  //       __re__emitExecutionContext as `utilityWorldName`. This is the per-page
  //       GUID-suffixed name that crPage.js uses to register a context as the
  //       utility world (crPage.js: contextPayload.name === this._crPage.utilityWorldName).
  //       Without this, waitForSelector / locators / page.click hang forever —
  //       the utility world context is created but never registered. See:
  //       docs/waitForSelector-bug.md for full investigation.
  //
  // UPSTREAM FRAGILITY:
  //   5a: anchor spans _recalculateNetworkIdle + _onLifecycleEvent("commit").
  //       If the frame commit lifecycle changes, update both lines.
  //   5b: anchor is the entire _context(world) function body (4 lines).
  //       If playwright refactors _context() (e.g. adds parameters, renames),
  //       update the search string.
  //       Also: if crPage.js renames `utilityWorldName` property, update the
  //       `this._page.delegate?.utilityWorldName` reference in the replacement.
  {
    file: 'server/frames.js',
    steps: src => {
      // 5a. emit executionContextsCleared on commit so CRConnection knows
      //     to re-acquire context IDs after navigation
      src = replace(
        'frames.js',
        src,
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
        'frames.js',
        src,
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
    return crSession.__re__emitExecutionContext({ world, targetId: this._id, frame: this, utilityWorldName: this._page.delegate?.utilityWorldName })
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

  // ── 6. page.js — update Worker constructor + guard PageBinding.dispatch ───────
  // Three changes:
  //   6a. Worker constructor: accept the targetId + session args added by patch #3b
  //       and store them for use in getExecutionContext()
  //   6b. Add getExecutionContext() to Worker; rewire evaluateExpression /
  //       evaluateExpressionHandle to use it. On first call, triggers
  //       __re__emitExecutionContext for the worker's main world.
  //   6c. Guard PageBinding.dispatch against non-JSON payloads: the addBinding
  //       round-trip in __re__getMainWorld fires Runtime.bindingCalled with a
  //       raw string payload (not our JSON envelope), which would crash JSON.parse.
  //
  // UPSTREAM FRAGILITY:
  //   6a: anchor is `constructor(parent, url)` + first two lines of Worker body.
  //       Must stay in sync with patch #3b (which adds the extra args at call site).
  //       If Worker constructor changes, update both #3b and #6a together.
  //   6b: anchor spans both evaluateExpression + evaluateExpressionHandle.
  //       If either method signature changes, update the search string.
  //   6c: anchor is `static async dispatch(page, payload, context)` + JSON.parse line.
  //       If dispatch is refactored, update search string.
  {
    file: 'server/page.js',
    steps: src => {
      // 6a. Worker constructor: accept targetId + session
      src = replace(
        'page.js',
        src,
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
        'page.js',
        src,
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
        'page.js',
        src,
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
  // ── 8. crPage.js — inject greasy brands into calculateUserAgentMetadata ────────
  // Problem: when browser.run_test connects via CDP, Playwright wraps the page via
  // connectOverCDP. On frame init, crPage.js calls _updateUserAgent() which calls
  // Emulation.setUserAgentOverride with calculateUserAgentMetadata(options). That
  // function builds the metadata object but never sets `brands`, so Chrome reverts
  // to its binary default (Chromium-only brands), clobbering the brands we set via
  // Network.setUserAgentOverride in applyStealthToExistingPage.
  //
  // Fix: append brands generation (greasy brand algorithm) to the end of
  // calculateUserAgentMetadata, just before `return metadata`. Brands are derived
  // from the Chrome major version in the UA string, matching what
  // applyStealthToExistingPage sets via Network.setUserAgentOverride.
  //
  // The greasy brand algorithm is the same as puppeteer-extra-plugin-stealth:
  // rotates brand order by (seed % 6) to avoid a static fingerprint.
  //
  // UPSTREAM FRAGILITY:
  //   Anchor: exact closing lines of calculateUserAgentMetadata.
  //   If ua.includes("ARM") or the return line moves, update the search string.
  {
    file: 'server/chromium/crPage.js',
    steps: src => {
      src = replace(
        'crPage.js',
        src,
        `  if (ua.includes("ARM"))
    metadata.architecture = "arm";
  return metadata;
}`,
        `  if (ua.includes("ARM"))
    metadata.architecture = "arm";
  // ── szkrabok: greasy brands ───────────────────────────────────────────────
  // Generate navigator.userAgentData.brands from the Chrome major version so
  // Playwright's own Emulation.setUserAgentOverride includes correct brands.
  const chromeMatch = ua.match(/Chrome\\/(\\d+)/);
  if (chromeMatch) {
    const seed = parseInt(chromeMatch[1], 10);
    const order = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]][seed % 6];
    const esc = [' ', ' ', ';'];
    const grease = \`\${esc[order[0]]}Not\${esc[order[1]]}A\${esc[order[2]]}Brand\`;
    const brands = [];
    brands[order[0]] = { brand: grease, version: '99' };
    brands[order[1]] = { brand: 'Chromium', version: String(seed) };
    brands[order[2]] = { brand: 'Google Chrome', version: String(seed) };
    metadata.brands = brands;
  }
  // ── end szkrabok greasy brands ────────────────────────────────────────────
  return metadata;
}`,
        'inject greasy brands into calculateUserAgentMetadata'
      )
      return src
    },
  },
  // ── 7. utilityScriptSource.js — rename UtilityScript class ───────────────────
  // The rebrowser bot-detector overrides document.getElementById and inspects
  // new Error().stack for the string "UtilityScript." (class.method notation).
  // Playwright injects a compiled UtilityScript bundle into every page context;
  // all page.evaluate() calls run through UtilityScript.evaluate().
  // Renaming the class variable to __pwUs breaks the stack-trace string match
  // without affecting functionality — the export key "UtilityScript" is kept so
  // internal playwright code that references it by name is unaffected.
  // This is an original szkrabok fix — rebrowser-patches only fixes this for
  // puppeteer (pptr: sourceURL), not playwright.
  //
  // UPSTREAM FRAGILITY:
  //   The file is a large generated JS bundle (single-line string).
  //   Anchors `var UtilityScript = class {` and `UtilityScript: () => UtilityScript`
  //   are stable — they are part of the compiled output naming convention.
  //   If playwright renames the class in source, update both search strings.
  {
    file: 'generated/utilityScriptSource.js',
    steps: src => {
      // The source is a large single-line JS string.  Inside it, the class is
      // declared as "var UtilityScript = class {" and exported via the key
      // "UtilityScript: () => UtilityScript".  We rename the variable only
      // (not the export key, which other playwright code references by name).
      src = replace(
        'utilityScriptSource.js',
        src,
        `var UtilityScript = class {`,
        `var __pwUs = class {`,
        'rename UtilityScript class variable'
      )
      // The export arrow also references the old name — update it
      src = replace(
        'utilityScriptSource.js',
        src,
        `UtilityScript: () => UtilityScript`,
        `UtilityScript: () => __pwUs`,
        'update UtilityScript export reference'
      )
      return src
    },
  },
]

// ── run ───────────────────────────────────────────────────────────────────────

// Markers to detect already-patched installs.
// All must be present for the install to be considered fully patched.
const PATCH_MARKERS = [
  { file: 'server/chromium/crConnection.js', marker: '__re__emitExecutionContext' }, // patch #1
  { file: 'server/chromium/crPage.js',       marker: 'szkrabok: greasy brands' },    // patch #8
]
// Stamp file written next to package.json so it's easy to see patches are active.
const STAMP_FILE = '.szkrabok-patched'

function isAlreadyPatched(libDir) {
  return PATCH_MARKERS.every(({ file, marker }) => {
    try {
      return fs.readFileSync(path.join(libDir, file), 'utf8').includes(marker)
    } catch {
      return false
    }
  })
}

// ── patch each playwright-core install ────────────────────────────────────────

let anyFailed = false

for (const pkgRoot of pkgRoots) {
  const pwVersion = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version
  const lib = path.join(pkgRoot, 'lib')
  const stamp = path.join(pkgRoot, STAMP_FILE)

  console.log(`\n[patch-playwright] playwright-core ${pwVersion} at ${pkgRoot}`)

  if (isAlreadyPatched(lib)) {
    console.log('  Already patched — skipping.')
    continue
  }

  // per-install backup list
  const backedUp = []

  function bakPath(rel) {
    return path.join(lib, rel) + '.bak'
  }
  function read(rel) {
    return fs.readFileSync(path.join(lib, rel), 'utf8')
  }
  function write(rel, content) {
    fs.writeFileSync(path.join(lib, rel), content, 'utf8')
  }

  function backup(rel) {
    fs.copyFileSync(path.join(lib, rel), bakPath(rel))
    backedUp.push(rel)
    console.log(`  backed up ${rel}`)
  }

  function rollback() {
    console.error('  Rolling back ...')
    for (const rel of backedUp) {
      const bak = bakPath(rel)
      try {
        fs.copyFileSync(bak, path.join(lib, rel))
        fs.unlinkSync(bak)
        console.error(`    restored ${rel}`)
      } catch (e) {
        console.error(`    FAILED to restore ${rel}: ${e.message} — backup at ${bak}`)
      }
    }
  }

  function removeBaks() {
    for (const rel of backedUp) {
      try {
        fs.unlinkSync(bakPath(rel))
      } catch {}
    }
  }

  console.log(`  Applying ${patches.length} patch groups ...`)
  let failed = false

  for (const { file, steps } of patches) {
    try {
      backup(file)
    } catch (e) {
      console.error(`  ERROR backing up ${file}: ${e.message}`)
      failed = true
      break
    }
    let src
    try {
      src = read(file)
    } catch (e) {
      console.error(`  ERROR reading ${file}: ${e.message}`)
      failed = true
      break
    }
    let patched
    try {
      patched = steps(src)
    } catch (e) {
      console.error(e.message.replace('[patch-playwright] ', '  '))
      failed = true
      break
    }
    try {
      write(file, patched)
      console.log(`  patched  ${file}`)
    } catch (e) {
      console.error(`  ERROR writing ${file}: ${e.message}`)
      failed = true
      break
    }
  }

  if (failed) {
    rollback()
    console.error(
      `\n  PATCH FAILED for playwright-core ${pwVersion} — files restored from .bak backups.`
    )
    console.error('  What to do:')
    console.error(`    1. Check what changed in playwright-core ${pwVersion}.`)
    console.error(
      '    2. Update the failing patch step search string in scripts/patch-playwright.js.'
    )
    console.error('    3. Re-run: node scripts/patch-playwright.js')
    console.error('  Reference: vendor/rebrowser-patches/patches/playwright-core/src.patch')
    anyFailed = true
  } else {
    removeBaks()
    // write stamp file so patches are visible at a glance
    fs.writeFileSync(stamp, `szkrabok-patched playwright-core@${pwVersion}\n`)
    console.log(`  All patches applied. Stamp: ${STAMP_FILE}`)
  }
}

if (anyFailed) process.exit(1)
console.log('\n[patch-playwright] Done.')
