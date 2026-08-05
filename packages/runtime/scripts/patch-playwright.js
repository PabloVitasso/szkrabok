#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Babel (required) ──────────────────────────────────────────────────────────
// Use require() — Babel packages are CJS; dynamic import() wraps module.exports
// in a namespace object, making tr.default the exports object, not the function.
let parse, traverse, generate, t
try {
  parse    = require('@babel/parser').parse
  traverse = require('@babel/traverse').default
  generate = require('@babel/generator').default
  t        = require('@babel/types')
} catch {
  console.error('[patch-playwright] ERROR: Babel packages not found.')
  console.error('  Run: npm install @babel/parser @babel/traverse @babel/generator @babel/types')
  process.exit(1)
}

const PARSER_OPTS = {
  sourceType: 'unambiguous',
  plugins: [
    'typescript', 'decorators-legacy', 'classProperties', 'classStaticBlock',
    'topLevelAwait', 'optionalChaining', 'nullishCoalescingOperator', 'importAssertions',
  ],
}

const parseAst = src => parse(src, PARSER_OPTS)
const emit     = ast => generate(ast, { comments: true }).code

// ── locate all playwright-core installs ───────────────────────────────────────

function resolvePlaywrightCoreRoot(fromDir) {
  try {
    const pkg = path.join(fromDir, 'node_modules', 'playwright-core', 'package.json')
    if (fs.existsSync(pkg)) return path.dirname(pkg)
    const r = require.resolve('playwright-core/package.json', { paths: [fromDir] })
    return path.dirname(r)
  } catch {
    return null
  }
}

function findPkgRoots() {
  const pkgRoot = path.resolve(__dirname, '..')
  const primary = resolvePlaywrightCoreRoot(pkgRoot)
  const roots = primary ? [primary] : []
  try {
    const playwrightPkg = path.dirname(require.resolve('playwright/package.json', { paths: [pkgRoot] }))
    const nested = resolvePlaywrightCoreRoot(playwrightPkg)
    if (nested && !roots.includes(nested)) return [...roots, nested]
  // eslint-disable-next-line no-empty -- playwright may not be installed; optional resolution
  } catch {}
  return roots
}

const pkgRoots = findPkgRoots()
if (!pkgRoots.length) {
  console.error('[patch-playwright] ERROR: playwright-core not found. Run `npm install` first.')
  process.exit(1)
}

// ── section-scoping helper ────────────────────────────────────────────────────
// esbuild emits `// packages/playwright-core/src/<path>` at column 0 before each
// compiled module. Use these as section boundaries so no patch accidentally matches
// the wrong class (e.g. 7 classes each have `_callbacks.clear()`).
// Use the full `packages/playwright-core/src/` prefix — the embedded UtilityScript
// string contains a `packages/injected/src/` comment with real newlines that would
// otherwise create a false split.

function extractSection(src, sectionPath) {
  const header = `// ${sectionPath}`
  const start = src.indexOf(header)
  if (start === -1)
    throw new Error(`[patch-playwright] Section header not found: ${sectionPath}`)
  const boundary = '\n// packages/playwright-core/src/'
  const next = src.indexOf(boundary, start + header.length)
  const end = next === -1 ? src.length : next + 1
  return { before: src.slice(0, start), section: src.slice(start, end), after: src.slice(end) }
}

function patchSection(src, sectionPath, transform) {
  const { before, section, after } = extractSection(src, sectionPath)
  return before + transform(section) + after
}

// ── string-replace helper ─────────────────────────────────────────────────────

function strReplace(label, content, searchStr, replacement) {
  if (!content.includes(searchStr)) {
    throw new Error(
      `[patch-playwright] Pattern not found\n` +
      `  patch: "${label}"\n` +
      `  searched for: ${searchStr.slice(0, 120).replace(/\n/g, '\\n')}\n` +
      `  Update the search string to match the new compiled source.`
    )
  }
  return content.replace(searchStr, replacement)
}

// ── AST helpers ───────────────────────────────────────────────────────────────

// Build:  process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0'
// NOTE: === '0' is correct — the call runs ONLY when patches are explicitly disabled.
function guardCondition() {
  return t.binaryExpression(
    '===',
    t.memberExpression(
      t.memberExpression(t.identifier('process'), t.identifier('env')),
      t.stringLiteral('REBROWSER_PATCHES_RUNTIME_FIX_MODE'),
      true
    ),
    t.stringLiteral('0')
  )
}

// Wrap every CallExpression whose first argument is 'Runtime.enable' so that the
// call only executes when REBROWSER_PATCHES_RUNTIME_FIX_MODE === '0'.
function astSuppressRuntimeEnable(src, label) {
  const ast = parseAst(src)
  let count = 0
  const processed = new WeakSet()

  traverse(ast, {
    CallExpression(nodePath) {
      if (processed.has(nodePath.node)) return
      const arg0 = nodePath.node.arguments?.[0] ?? null
      if (!t.isStringLiteral(arg0) || arg0.value !== 'Runtime.enable') return

      let root = nodePath
      while (
        root.parentPath &&
        (root.parentPath.isCallExpression() ||
         root.parentPath.isMemberExpression() ||
         root.parentPath.isAwaitExpression())
      ) root = root.parentPath

      processed.add(nodePath.node)

      const parentIsExprStmt = root.parentPath?.isExpressionStatement() ?? false
      if (parentIsExprStmt) {
        root.parentPath.replaceWith(
          t.ifStatement(
            guardCondition(),
            t.blockStatement([t.expressionStatement(root.node)]),
            null
          )
        )
      } else {
        root.replaceWith(
          t.conditionalExpression(
            guardCondition(),
            root.node,
            t.callExpression(t.arrowFunctionExpression([], t.blockStatement([])), [])
          )
        )
      }
      count++
    },
  })

  if (count === 0)
    throw new Error(`[patch-playwright] AST found no Runtime.enable calls in section: ${label}`)

  return emit(ast)
}

// ── patch definitions ─────────────────────────────────────────────────────────
// Each patch targets a named section of lib/coreBundle.js, identified by its
// esbuild-emitted source file header comment.

const BUNDLE_FILE = 'coreBundle.js'

const patches = [

  // ── 1. crConnection — inject __re__ helpers into CRSession ──────────────────
  {
    name: 'crConnection: inject __re__ helpers',
    section: 'packages/playwright-core/src/server/chromium/crConnection.ts',
    apply: sec => strReplace(
      'crConnection: inject __re__ helpers',
      sec,
      `        this._callbacks.clear();
      }
    };
    CDPSession = class _CDPSession extends SdkObject {`,
      `        this._callbacks.clear();
      }

      // ── rebrowser Runtime.enable fix ─────────────────────────────────────────
      async __re__emitExecutionContext({ world, targetId, frame = null, utilityWorldName: callerUtilityWorldName }) {
        const fixMode = process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] || 'addBinding'
        let utilityWorldName;
        if (process.env['REBROWSER_PATCHES_UTILITY_WORLD_NAME'] !== '0') {
          utilityWorldName = process.env['REBROWSER_PATCHES_UTILITY_WORLD_NAME'] || 'util';
        } else {
          utilityWorldName = '__playwright_utility_world__';
        }
        if (process.env['REBROWSER_PATCHES_DEBUG']) {
          console.log(\`[rebrowser-patches][crSession] targetId=\${targetId} world=\${world} frame=\${frame ? 'Y' : 'N'} fixMode=\${fixMode}\`);
        }

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
      // ── end rebrowser fix ─────────────────────────────────────────────────────
    };
    CDPSession = class _CDPSession extends SdkObject {`
    ),
  },

  // ── 2. crDevTools — suppress Runtime.enable (AST) ──────────────────────────
  {
    name: 'crDevTools: suppress Runtime.enable',
    section: 'packages/playwright-core/src/server/chromium/crDevTools.ts',
    apply: sec => astSuppressRuntimeEnable(sec, 'crDevTools'),
  },

  // ── 3. crPage — Worker callsite: pass targetId + session ───────────────────
  {
    name: 'crPage: Worker callsite pass targetId+session',
    section: 'packages/playwright-core/src/server/chromium/crPage.ts',
    apply: sec => strReplace(
      'crPage: Worker callsite pass targetId+session',
      sec,
      `const worker = new Worker(this._page, url3);`,
      `const worker = new Worker(this._page, url3, undefined, event.targetInfo.targetId, session2);`
    ),
  },

  // ── 4. crPage — greasy brands in _updateUserAgent ──────────────────────────
  // In 1.60.0 calculateUserAgentMetadata() no longer returns brands.
  // Inject brands at the CDP callsite in _updateUserAgent().
  // In 1.61.0 the local variable was renamed options2 → options.
  {
    name: 'crPage: greasy brands in _updateUserAgent',
    section: 'packages/playwright-core/src/server/chromium/crPage.ts',
    apply: sec => strReplace(
      'crPage: greasy brands in _updateUserAgent',
      sec,
      `async _updateUserAgent() {
        const options = this._crPage._browserContext._options;
        await this._client.send("Emulation.setUserAgentOverride", {
          userAgent: options.userAgent || "",
          acceptLanguage: options.locale,
          userAgentMetadata: calculateUserAgentMetadata(options)
        });
      }`,
      `async _updateUserAgent() {
        const options = this._crPage._browserContext._options;
        // ── szkrabok: greasy brands ──────────────────────────────────────────────
        const _uaMeta = calculateUserAgentMetadata(options);
        const _chromeMatch = (options.userAgent || '').match(/Chrome\\/(\\.d+)/);
        if (_uaMeta && _chromeMatch) {
          const seed = parseInt(_chromeMatch[1], 10);
          const order = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]][seed % 6];
          const esc = [' ', ' ', ';'];
          const grease = \`\${esc[order[0]]}Not\${esc[order[1]]}A\${esc[order[2]]}Brand\`;
          const _brands = [];
          _brands[order[0]] = { brand: grease, version: '99' };
          _brands[order[1]] = { brand: 'Chromium', version: String(seed) };
          _brands[order[2]] = { brand: 'Google Chrome', version: String(seed) };
          _uaMeta.brands = _brands;
        }
        // ── end szkrabok greasy brands ────────────────────────────────────────────
        await this._client.send("Emulation.setUserAgentOverride", {
          userAgent: options.userAgent || "",
          acceptLanguage: options.locale,
          userAgentMetadata: _uaMeta
        });
      }`
    ),
  },

  // ── 5. crPage — suppress Runtime.enable (AST) ──────────────────────────────
  // Must run AFTER string replacements because emit() reformats the section,
  // making string anchors unmatchable afterward.
  {
    name: 'crPage: suppress Runtime.enable',
    section: 'packages/playwright-core/src/server/chromium/crPage.ts',
    apply: sec => astSuppressRuntimeEnable(sec, 'crPage'),
  },

  // ── 6. crServiceWorker — suppress Runtime.enable (AST) ─────────────────────
  {
    name: 'crServiceWorker: suppress Runtime.enable',
    section: 'packages/playwright-core/src/server/chromium/crServiceWorker.ts',
    apply: sec => astSuppressRuntimeEnable(sec, 'crServiceWorker'),
  },

  // ── 7. frames — emit executionContextsCleared on commit ────────────────────
  {
    name: 'frames: emit executionContextsCleared on commit',
    section: 'packages/playwright-core/src/server/frames.ts',
    apply: sec => strReplace(
      'frames: emit executionContextsCleared on commit',
      sec,
      `this._page.mainFrame()._recalculateNetworkIdle(this);
        this.onLifecycleEvent("commit");
      }`,
      `this._page.mainFrame()._recalculateNetworkIdle(this);
        this.onLifecycleEvent("commit");
        const crSession = (this._page.delegate._sessions?.get(this._id) || this._page.delegate._mainFrameSession)?._client
        if (crSession) crSession.emit('Runtime.executionContextsCleared')
      }`
    ),
  },

  // ── 8. frames — rewire context() to use __re__emitExecutionContext ──────────
  // Method renamed _context → context in 1.60.0 esbuild output (underscore dropped).
  // Recursive call must also use context() (not _context()).
  // In 1.61.0 a noUtilityWorld guard was added at the top — preserve it.
  {
    name: 'frames: rewire context() via __re__emitExecutionContext',
    section: 'packages/playwright-core/src/server/frames.ts',
    apply: sec => strReplace(
      'frames: rewire context() via __re__emitExecutionContext',
      sec,
      `      context(world) {
        if (this._page.delegate.noUtilityWorld?.())
          world = "main";
        return this._contextData.get(world).contextPromise.then((contextOrDestroyedReason) => {
          if (contextOrDestroyedReason instanceof ExecutionContext)
            return contextOrDestroyedReason;
          throw new Error(contextOrDestroyedReason.destroyedReason);
        });
      }`,
      `      context(world, useContextPromise = false) {
        if (this._page.delegate.noUtilityWorld?.())
          world = "main";
        if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0' || this._contextData.get(world).context || useContextPromise) {
          return this._contextData.get(world).contextPromise.then((contextOrDestroyedReason) => {
            if (contextOrDestroyedReason instanceof ExecutionContext)
              return contextOrDestroyedReason;
            throw new Error(contextOrDestroyedReason.destroyedReason);
          });
        }
        const crSession = (this._page.delegate._sessions?.get(this._id) || this._page.delegate._mainFrameSession)?._client
        return crSession.__re__emitExecutionContext({ world, targetId: this._id, frame: this, utilityWorldName: this._page.delegate?.utilityWorldName })
          .then(() => this.context(world, true))
          .catch(error => {
            if (error.message.includes('No frame for given id found'))
              return { destroyedReason: 'Frame was detached' }
            console.error('[rebrowser-patches][frames.context] error:', error)
          })
      }`
    ),
  },

  // ── 9. page — Worker constructor: add targetId + session params ─────────────
  {
    name: 'page: Worker constructor add targetId+session',
    section: 'packages/playwright-core/src/server/page.ts',
    apply: sec => strReplace(
      'page: Worker constructor add targetId+session',
      sec,
      `constructor(parent, url3, onDisconnect) {
        super(parent, "worker");
        this._executionContextPromise = new ManualPromise();
        this._workerScriptLoaded = false;
        this.existingExecutionContext = null;
        this.openScope = new LongStandingScope();
        this.attribution.worker = this;
        this.url = url3;
        this._onDisconnect = onDisconnect;
      }`,
      `constructor(parent, url3, onDisconnect, targetId, session) {
        super(parent, "worker");
        this._executionContextPromise = new ManualPromise();
        this._workerScriptLoaded = false;
        this.existingExecutionContext = null;
        this.openScope = new LongStandingScope();
        this.attribution.worker = this;
        this.url = url3;
        this._onDisconnect = onDisconnect;
        this._targetId = targetId;
        this._session = session;
      }`
    ),
  },

  // ── 10. page — Worker evaluateExpression: use getExecutionContext() ──────────
  // In 1.60.0 both methods take leading progress2 param and call the free
  // function evaluateExpression() (not js.evaluateExpression).
  {
    name: 'page: Worker evaluateExpression use getExecutionContext',
    section: 'packages/playwright-core/src/server/page.ts',
    apply: sec => strReplace(
      'page: Worker evaluateExpression use getExecutionContext',
      sec,
      `async evaluateExpression(progress2, expression2, isFunction2, arg) {
        return progress2.race(evaluateExpression(await this._executionContextPromise, expression2, { returnByValue: true, isFunction: isFunction2 }, arg));
      }
      async evaluateExpressionHandle(progress2, expression2, isFunction2, arg) {
        return progress2.race(evaluateExpression(await this._executionContextPromise, expression2, { returnByValue: false, isFunction: isFunction2 }, arg));
      }`,
      `async getExecutionContext() {
        if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] !== '0' && !this.existingExecutionContext) {
          await this._session.__re__emitExecutionContext({ world: 'main', targetId: this._targetId })
        }
        return this._executionContextPromise
      }
      async evaluateExpression(progress2, expression2, isFunction2, arg) {
        return progress2.race(evaluateExpression(await this.getExecutionContext(), expression2, { returnByValue: true, isFunction: isFunction2 }, arg));
      }
      async evaluateExpressionHandle(progress2, expression2, isFunction2, arg) {
        return progress2.race(evaluateExpression(await this.getExecutionContext(), expression2, { returnByValue: false, isFunction: isFunction2 }, arg));
      }`
    ),
  },

  // ── 11. page — PageBinding.dispatch: guard non-JSON payloads ────────────────
  {
    name: 'page: PageBinding.dispatch guard non-JSON',
    section: 'packages/playwright-core/src/server/page.ts',
    apply: sec => strReplace(
      'page: PageBinding.dispatch guard non-JSON',
      sec,
      `static async dispatch(page, payload, context2) {
        const { name, seq, serializedArgs } = JSON.parse(payload);`,
      `static async dispatch(page, payload, context2) {
        if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] !== '0' && !payload.includes('{')) return;
        const { name, seq, serializedArgs } = JSON.parse(payload);`
    ),
  },

  // ── 12. utilityScriptSource — rename UtilityScript class ────────────────────
  // The UtilityScript bundle is inlined as a string literal inside coreBundle.js.
  // String replacement works directly on the raw file content.
  {
    name: 'utilityScriptSource: rename UtilityScript class',
    section: 'packages/playwright-core/src/generated/utilityScriptSource.ts',
    apply: sec => {
      sec = strReplace('utilityScriptSource: rename class var',   sec, 'var UtilityScript = class {', 'var __pwUs = class {')
      sec = strReplace('utilityScriptSource: rename export ref',  sec, 'UtilityScript: () => UtilityScript', 'UtilityScript: () => __pwUs')
      return sec
    },
  },

]

// ── patch markers and stamp ───────────────────────────────────────────────────

const PATCH_MARKERS = [
  { file: 'coreBundle.js', marker: '__re__emitExecutionContext' },
  { file: 'coreBundle.js', marker: 'szkrabok: greasy brands'   },
]
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
  const pwVersion = JSON.parse(
    fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')
  ).version
  const lib   = path.join(pkgRoot, 'lib')
  const stamp = path.join(pkgRoot, STAMP_FILE)

  console.log(`\n[patch-playwright] playwright-core ${pwVersion} at ${pkgRoot}`)

  if (isAlreadyPatched(lib)) {
    console.log('  Already patched — skipping.')
    continue
  }

  const bundlePath = path.join(lib, BUNDLE_FILE)
  if (!fs.existsSync(bundlePath)) {
    console.error(`  ERROR: ${BUNDLE_FILE} not found — unexpected package layout for ${pwVersion}`)
    anyFailed = true
    continue
  }

  const bakPath = bundlePath + '.bak'
  let backedUp = false

  function rollback() {
    if (backedUp) {
      console.error('  Rolling back ...')
      try {
        fs.copyFileSync(bakPath, bundlePath)
        fs.unlinkSync(bakPath)
        console.error(`    restored ${BUNDLE_FILE}`)
      } catch (e) {
        console.error(`    FAILED to restore ${BUNDLE_FILE}: ${e.message} — backup at ${bakPath}`)
      }
    }
  }

  console.log(`  Applying ${patches.length} patch entries to ${BUNDLE_FILE} ...`)
  let failed = false
  let src

  try {
    fs.copyFileSync(bundlePath, bakPath)
    backedUp = true
    console.log(`  backed up  ${BUNDLE_FILE}`)
    src = fs.readFileSync(bundlePath, 'utf8')
  } catch (e) {
    console.error(`  ERROR reading ${BUNDLE_FILE}: ${e.message}`)
    failed = true
  }

  if (!failed) {
    // Group patches by section so we read/write the accumulator once per section
    // rather than re-reading the file. Build a final src by applying all transforms.
    const grouped = new Map()
    for (const patch of patches) {
      grouped.set(patch.section, [...(grouped.get(patch.section) ?? []), patch])
    }

    for (const [section, sectionPatches] of grouped) {
      for (const patch of sectionPatches) {
        try {
          src = patchSection(src, section, patch.apply)
          console.log(`  patched    ${patch.name}`)
        } catch (e) {
          console.error(e.message.replace('[patch-playwright] ', '  '))
          failed = true
          break
        }
      }
      if (failed) break
    }
  }

  if (failed) {
    rollback()
    console.error(`\n  PATCH FAILED for playwright-core ${pwVersion} — ${BUNDLE_FILE} restored.`)
    anyFailed = true
  } else {
    try {
      fs.writeFileSync(bundlePath, src, 'utf8')
      fs.unlinkSync(bakPath)
      fs.writeFileSync(stamp, `szkrabok-patched playwright-core@${pwVersion}\n`)
      console.log(`  All patches applied. Stamp: ${STAMP_FILE}`)
    } catch (e) {
      console.error(`  ERROR writing ${BUNDLE_FILE}: ${e.message}`)
      rollback()
      anyFailed = true
    }
  }
}

if (anyFailed) process.exit(1)
console.log('\n[patch-playwright] Done.')
