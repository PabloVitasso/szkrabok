#!/usr/bin/env node
/**
 * patch-playwright-best.js  (fixed: guardCondition uses === not !==)
 */

import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Babel (required) ──────────────────────────────────────────────────────────
// Use require() — Babel packages are CJS; dynamic import() wraps module.exports
// in a namespace object, making tr.default the exports object, not the function.
// require('@babel/traverse').default === traverse function  (per Babel docs)
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
  const roots = []
  const pkgRoot = path.resolve(__dirname, '..')

  const primary = resolvePlaywrightCoreRoot(pkgRoot)
  if (primary) roots.push(primary)

  try {
    const playwrightPkg = path.dirname(require.resolve('playwright/package.json', { paths: [pkgRoot] }))
    const nested = resolvePlaywrightCoreRoot(playwrightPkg)
    if (nested && !roots.includes(nested)) roots.push(nested)
  // eslint-disable-next-line no-empty -- playwright may not be installed; optional resolution
  } catch {}

  return roots
}

const pkgRoots = findPkgRoots()
if (!pkgRoots.length) {
  console.error('[patch-playwright] ERROR: playwright-core not found. Run `npm install` first.')
  process.exit(1)
}

// ── string-replace helper ─────────────────────────────────────────────────────

function strReplace(file, content, searchStr, replacement, label) {
  if (!content.includes(searchStr)) {
    throw new Error(
      `[patch-playwright] Pattern not found in ${file}\n` +
      `  patch: "${label}"\n` +
      `  searched for: ${searchStr.slice(0, 120).replace(/\n/g, '\\n')}\n\n` +
      `  Update the search string to match the new compiled source.\n` +
      `  Reference: vendor/rebrowser-patches/patches/playwright-core/src.patch`
    )
  }
  return content.replace(searchStr, replacement)
}

// ── AST helpers ───────────────────────────────────────────────────────────────

/**
 * Build the guard condition AST node:
 *   process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0'
 *
 * NOTE: === '0' is correct — the call is run ONLY when patches are disabled.
 * Using !== '0' here would be inverted (call Runtime.enable by default).
 */
function guardCondition() {
  return t.binaryExpression(
    '===',
    t.memberExpression(
      t.memberExpression(t.identifier('process'), t.identifier('env')),
      t.stringLiteral('REBROWSER_PATCHES_RUNTIME_FIX_MODE'),
      true // computed
    ),
    t.stringLiteral('0')
  )
}

/**
 * AST-based Runtime.enable suppression.
 *
 * Finds every CallExpression where the first argument is "Runtime.enable"
 * and wraps it so the call only runs when REBROWSER_PATCHES_RUNTIME_FIX_MODE === '0'
 * (i.e., when patches are explicitly disabled).
 *
 * Statement-level: replaces with an if-block.
 * Inside array/args: replaces with a ternary (empty IIFE as the false branch).
 */
function astSuppressRuntimeEnable(src, filename) {
  const ast = parseAst(src)
  let count = 0
  // Track already-processed CallExpression nodes so Babel's re-traversal of
  // newly inserted If/Conditional nodes doesn't wrap the same call again.
  const processed = new WeakSet()

  traverse(ast, {
    CallExpression(nodePath) {
      if (processed.has(nodePath.node)) return
      const arg0 = nodePath.node.arguments?.[0]
      if (!t.isStringLiteral(arg0) || arg0.value !== 'Runtime.enable') return

      // Walk up past .send(), await, member-access etc. to the "root" expression
      let root = nodePath
      while (
        root.parentPath &&
        (root.parentPath.isCallExpression() ||
         root.parentPath.isMemberExpression() ||
         root.parentPath.isAwaitExpression())
      ) {
        root = root.parentPath
      }

      // Mark before replacing — prevents infinite re-wrap when Babel re-visits
      // the CallExpression inside the newly inserted If/Conditional node.
      processed.add(nodePath.node)

      if (root.parentPath?.isExpressionStatement()) {
        // Statement-level guard
        root.parentPath.replaceWith(
          t.ifStatement(
            guardCondition(),
            t.blockStatement([t.expressionStatement(root.node)]),
            null
          )
        )
      } else {
        // Inside Promise.all([...]) or similar — inline ternary
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

  if (count === 0) {
    throw new Error(
      `[patch-playwright] AST found no Runtime.enable calls in ${filename}.\n` +
      `  Update astSuppressRuntimeEnable if the file was restructured upstream.`
    )
  }

  return emit(ast)
}

/**
 * AST-based UtilityScript class rename: UtilityScript → __pwUs.
 *
 * Renames the variable declaration and all non-key Identifier references,
 * leaving the "UtilityScript" object property key (export) untouched.
 */
function _astRenameUtilityScript(src, filename) {
  const ast = parseAst(src)
  let count = 0

  traverse(ast, {
    VariableDeclarator(p) {
      if (t.isIdentifier(p.node.id, { name: 'UtilityScript' })) {
        p.node.id.name = '__pwUs'
        count++
      }
    },
    Identifier(p) {
      if (p.node.name !== 'UtilityScript') return
      const parent = p.parent
      // Skip export key and import/export specifier positions
      if (
        (parent.type === 'ObjectProperty' && parent.key === p.node && !parent.computed) ||
        parent.type === 'ExportSpecifier' ||
        parent.type === 'ImportSpecifier'
      ) return
      p.node.name = '__pwUs'
      count++
    },
  })

  if (count === 0) {
    throw new Error(
      `[patch-playwright] AST found no UtilityScript identifier in ${filename}.\n` +
      `  Update astRenameUtilityScript if the class was renamed upstream.`
    )
  }

  return emit(ast)
}

// ── patch definitions ─────────────────────────────────────────────────────────

const patches = [
  // ── 1. crConnection.js — inject __re__ helpers into CRSession ────────────────
  {
    file: 'server/chromium/crConnection.js',
    steps: src => strReplace(
      'crConnection.js', src,
      `    this._callbacks.clear();
  }
}
class CDPSession`,
      `    this._callbacks.clear();
  }

  // ── rebrowser Runtime.enable fix ──────────────────────────────────────────
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
class CDPSession`,
      'inject __re__ helpers into CRSession'
    ),
  },

  // ── 2. crDevTools.js — suppress Runtime.enable (AST) ─────────────────────────
  {
    file: 'server/chromium/crDevTools.js',
    steps: src => astSuppressRuntimeEnable(src, 'crDevTools.js'),
  },

  // ── 3+8. crPage.js — all changes in ONE step ─────────────────────────────────
  // String replacements must run BEFORE astSuppressRuntimeEnable because Babel's
  // emit() reformats the entire file, making string anchors unmatchable afterward.
  // Order within this step:
  //   1. Worker call-site string replace (on original source)
  //   2. Greasy brands string inject (on original source)
  //   3. AST suppress Runtime.enable (last — reformats the whole file via emit())
  {
    file: 'server/chromium/crPage.js',
    steps: src => {
      // 3b. pass targetId+session to Worker constructor
      src = strReplace(
        'crPage.js', src,
        `    const worker = new import_page.Worker(this._page, url);`,
        `    const worker = new import_page.Worker(this._page, url, event.targetInfo.targetId, session);`,
        'pass targetId+session to Worker constructor'
      )
      // 8. greasy brands injection into calculateUserAgentMetadata
      src = strReplace(
        'crPage.js', src,
        `  if (ua.includes("ARM"))
    metadata.architecture = "arm";
  return metadata;
}`,
        `  if (ua.includes("ARM"))
    metadata.architecture = "arm";
  // ── szkrabok: greasy brands ───────────────────────────────────────────────
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
      // 3a. AST suppress Runtime.enable — runs last since emit() reformats the file
      src = astSuppressRuntimeEnable(src, 'crPage.js')
      return src
    },
  },

  // ── 4. crServiceWorker.js — suppress Runtime.enable (AST) ────────────────────
  {
    file: 'server/chromium/crServiceWorker.js',
    steps: src => astSuppressRuntimeEnable(src, 'crServiceWorker.js'),
  },

  // ── 5. frames.js — emit executionContextsCleared + rewire _context() ─────────
  {
    file: 'server/frames.js',
    steps: src => {
      src = strReplace(
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
      src = strReplace(
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
  {
    file: 'server/page.js',
    steps: src => {
      src = strReplace(
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
      src = strReplace(
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
      src = strReplace(
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

  // ── 7. utilityScriptSource.js — rename UtilityScript class (string replace) ───
  // The file exports a const source = '...' string literal that embeds the entire
  // UtilityScript bundle as text. Babel parses only the outer JS, so UtilityScript
  // is never an AST node — it is plain text inside a StringLiteral. AST traversal
  // cannot reach it; simple string replacement is the only correct approach.
  {
    file: 'generated/utilityScriptSource.js',
    steps: src => {
      src = strReplace('utilityScriptSource.js', src,
        'var UtilityScript = class {',
        'var __pwUs = class {',
        'rename UtilityScript class variable'
      )
      src = strReplace('utilityScriptSource.js', src,
        'UtilityScript: () => UtilityScript',
        'UtilityScript: () => __pwUs',
        'update UtilityScript export reference'
      )
      return src
    },
  },

]

// ── patch markers and stamp ───────────────────────────────────────────────────

const PATCH_MARKERS = [
  { file: 'server/chromium/crConnection.js', marker: '__re__emitExecutionContext' },
  { file: 'server/chromium/crPage.js',       marker: 'szkrabok: greasy brands' },
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

  const backedUp = new Set()

  const bakPath = rel => path.join(lib, rel) + '.bak'
  const read    = rel => fs.readFileSync(path.join(lib, rel), 'utf8')
  const write   = (rel, content) => fs.writeFileSync(path.join(lib, rel), content, 'utf8')

  function backup(rel) {
    if (backedUp.has(rel)) return
    fs.copyFileSync(path.join(lib, rel), bakPath(rel))
    backedUp.add(rel)
    console.log(`  backed up  ${rel}`)
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
      // eslint-disable-next-line no-empty -- best-effort .bak removal after patching; stale .bak is benign
      try { fs.unlinkSync(bakPath(rel)) } catch {}
    }
  }

  console.log(`  Applying ${patches.length} patch entries ...`)
  let failed = false

  for (const { file, steps } of patches) {
    try {
      backup(file)
    } catch (e) {
      console.error(`  ERROR backing up ${file}: ${e.message}`)
      failed = true; break
    }

    let src
    try {
      src = read(file)
    } catch (e) {
      console.error(`  ERROR reading ${file}: ${e.message}`)
      failed = true; break
    }

    let patched
    try {
      patched = steps(src)
    } catch (e) {
      console.error(e.message.replace('[patch-playwright] ', '  '))
      failed = true; break
    }

    try {
      write(file, patched)
      console.log(`  patched    ${file}`)
    } catch (e) {
      console.error(`  ERROR writing ${file}: ${e.message}`)
      failed = true; break
    }
  }

  if (failed) {
    rollback()
    console.error(`\n  PATCH FAILED for playwright-core ${pwVersion} — all files restored.`)
    anyFailed = true
  } else {
    removeBaks()
    fs.writeFileSync(stamp, `szkrabok-patched playwright-core@${pwVersion}\n`)
    console.log(`  All patches applied. Stamp: ${STAMP_FILE}`)
  }
}

if (anyFailed) process.exit(1)
console.log('\n[patch-playwright] Done.')
