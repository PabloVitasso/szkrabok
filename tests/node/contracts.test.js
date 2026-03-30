/**
 * Phase 5.3 — MCP contract tests.
 *
 * Uses static import analysis to enforce boundary invariants.
 * No browser launched. Runs fast.
 *
 * Run:
 *   node --test tests/node/contracts.test.js
 *
 * Invariants verified:
 * 1. No MCP tool file calls chromium.launch or chromium.launchPersistentContext
 * 2. Every session open in MCP goes through runtime.launch()
 * 3. Pool access in MCP tools comes via @szkrabok/runtime (not direct import of pool internals)
 * 4. tests/playwright/e2e/fixtures.js does not import stealth internals
 * 6. resolve.js is the single browser resolution entry point
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MCP_TOOLS_DIR = join(REPO_ROOT, 'src', 'tools');
const E2E_DIR = join(REPO_ROOT, 'tests', 'playwright', 'e2e');

// Read file content, return '' if missing
const readSrc = async path => readFile(path, 'utf8').catch(() => '');

// Get all .js files in a directory (non-recursive)
const jsFiles = async dir => {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter(e => e.isFile() && e.name.endsWith('.js')).map(e => join(dir, e.name));
};

describe('Invariant 1: no chromium.launch* in MCP tools', () => {
  test('no direct chromium.launch calls', async () => {
    const files = await jsFiles(MCP_TOOLS_DIR);
    const violations = await Promise.all(
      files.map(async file => {
        const raw = await readSrc(file);
        // Match chromium.launch( or chromium.launchPersistentContext( — excluding comments
        return /chromium\s*\.\s*launch/i.test(stripComments(raw)) ? file : null;
      })
    ).then(results => results.filter(Boolean));

    assert.deepEqual(
      violations,
      [],
      `MCP tool files must not call chromium.launch*(). Violations:\n${violations.join('\n')}`
    );
  });
});

describe('Invariant 2: session.open delegates to runtime.launch', () => {
  test('szkrabok_session.js imports from @szkrabok/runtime or #runtime', async () => {
    const src = await readSrc(join(MCP_TOOLS_DIR, 'szkrabok_session.js'));
    assert.ok(
      src.includes("from '@szkrabok/runtime'") || src.includes("from '#runtime'"),
      "szkrabok_session.js must import from '@szkrabok/runtime' or '#runtime'"
    );
  });

  test('szkrabok_session.js does not import launchPersistentContext', async () => {
    const src = await readSrc(join(MCP_TOOLS_DIR, 'szkrabok_session.js'));
    assert.ok(
      !src.includes('launchPersistentContext'),
      'szkrabok_session.js must not import or call launchPersistentContext'
    );
  });
});

describe('Invariant 3: pool access goes through @szkrabok/runtime public API only', () => {
  test('src/core/ directory does not exist (no bridge files)', async () => {
    const { existsSync } = await import('fs');
    assert.ok(
      !existsSync(join(REPO_ROOT, 'src', 'core')),
      'src/core/ must not exist — no pool or storage bridge files allowed'
    );
  });

  test('MCP tools do not import any @szkrabok/runtime subpaths', async () => {
    const files = await jsFiles(MCP_TOOLS_DIR);
    const violations = await Promise.all(
      files.map(async file => {
        const src = await readSrc(file);
        return /@szkrabok\/runtime\//.test(src) ? file : null;
      })
    ).then(results => results.filter(Boolean));

    assert.deepEqual(
      violations,
      [],
      `MCP tools must not import @szkrabok/runtime subpaths — use the public API only. Violations:\n${violations.join('\n')}`
    );
  });
});

describe('Invariant 4: tests/playwright/e2e/fixtures.js has no stealth imports', () => {
  test('fixtures.js does not import stealth internals', async () => {
    const src = await readSrc(join(E2E_DIR, 'fixtures.js'));
    const stealthPatterns = [
      'szkrabok_stealth',
      'playwright-extra',
      'puppeteer-extra-plugin-stealth',
    ];
    for (const pattern of stealthPatterns) {
      assert.ok(!src.includes(pattern), `e2e/fixtures.js must not import "${pattern}"`);
    }
  });

  test('fixtures.js does not call chromium.launch', async () => {
    const raw = await readSrc(join(E2E_DIR, 'fixtures.js'));
    assert.ok(
      !/chromium\s*\.\s*launch/.test(stripComments(raw)),
      'e2e/fixtures.js must not call chromium.launch*()'
    );
  });

  test('fixtures.js references @szkrabok/runtime for standalone path (dynamic import only)', async () => {
    const src = await readSrc(join(E2E_DIR, 'fixtures.js'));
    // Must reference runtime for standalone stealth launch.
    assert.ok(
      src.includes("'@szkrabok/runtime'"),
      "e2e/fixtures.js must reference '@szkrabok/runtime'"
    );
    // Must NOT have a static top-level import — MCP path requires zero runtime dependency.
    assert.ok(
      !/^import\s+.*szkrabok.*runtime/m.test(src),
      'e2e/fixtures.js must not have a static top-level runtime import'
    );
  });
});

describe('Invariant N: src/fixtures.js structural contracts', () => {
  const FIXTURES_SRC = join(REPO_ROOT, 'src', 'fixtures.js');

  test('no static runtime import', async () => {
    const src = await readSrc(FIXTURES_SRC);
    assert.ok(
      !/^import\s+.*szkrabok.*runtime/m.test(src),
      'src/fixtures.js must not have a static top-level runtime import'
    );
  });

  test('uses writeAttachSignal', async () => {
    const src = await readSrc(FIXTURES_SRC);
    assert.ok(src.includes('writeAttachSignal'), 'src/fixtures.js must use writeAttachSignal');
  });

  test('no silent catch', async () => {
    const src = await readSrc(FIXTURES_SRC);
    assert.ok(
      !/catch\s*\(\s*\)\s*\{\s*\}/.test(src),
      'src/fixtures.js must not have a silent catch block'
    );
  });

  test('has resolveConfig', async () => {
    const src = await readSrc(FIXTURES_SRC);
    assert.ok(src.includes('resolveConfig'), 'src/fixtures.js must define resolveConfig');
  });

  test('has ownsBrowser', async () => {
    const src = await readSrc(FIXTURES_SRC);
    assert.ok(src.includes('ownsBrowser'), 'src/fixtures.js must use ownsBrowser');
  });

  test('signal written before await use(session)', async () => {
    const src = await readSrc(FIXTURES_SRC);
    const signalIdx = src.indexOf('writeAttachSignal');
    const useIdx = src.indexOf('await use(session)');
    assert.ok(signalIdx !== -1, 'writeAttachSignal not found');
    assert.ok(useIdx !== -1, 'await use(session) not found');
    assert.ok(
      signalIdx < useIdx,
      'writeAttachSignal must appear before await use(session) in source'
    );
  });

  test('session and browser are worker-scoped; context is not overridden', async () => {
    const src = await readSrc(FIXTURES_SRC);
    const matches = src.match(/scope:\s*'worker'/g) ?? [];
    // session + browser = at least 2
    // context intentionally absent: Playwright 1.58+ disallows scope override of built-in test-scoped context
    assert.ok(
      matches.length >= 2,
      `Expected at least 2 worker-scope declarations (session, browser), found ${matches.length}`
    );
    assert.ok(
      !src.includes('context: ['),
      'context fixture must not be declared — conflicts with Playwright built-in test-scoped context'
    );
  });

  test('option declarations present', async () => {
    const src = await readSrc(FIXTURES_SRC);
    for (const opt of ['szkrabokCdpEndpoint', 'szkrabokAttachSignal', 'szkrabokSessionMode']) {
      assert.ok(src.includes(opt), `src/fixtures.js missing option: ${opt}`);
    }
  });
});

describe('package.json peer dep: @playwright/test optional', () => {
  test('declares @playwright/test as optional peer dep', async () => {
    const pkg = JSON.parse(await readSrc(join(REPO_ROOT, 'package.json')));
    assert.ok(
      pkg.peerDependencies?.['@playwright/test'],
      'peerDependencies entry missing for @playwright/test'
    );
    assert.ok(
      pkg.peerDependenciesMeta?.['@playwright/test']?.optional === true,
      'peerDependenciesMeta.optional must be true for @playwright/test'
    );
  });
});

describe('Invariant 5: packages/runtime is the only launch site', () => {
  test('only packages/runtime/launch.js contains launchPersistentContext', async () => {
    const searchDirs = [
      join(REPO_ROOT, 'src'),
      join(REPO_ROOT, 'tests'),
      join(REPO_ROOT, 'packages', 'mcp-client'),
    ];

    const violations = [];

    for (const dir of searchDirs) {
      const allFiles = await getAllJsFiles(dir);
      for (const file of allFiles) {
        // Skip spec/test files — they may reference the term in assertions/strings
        if (file.endsWith('.spec.js') || file.endsWith('.test.js')) continue;

        const raw = await readSrc(file);
        const src = stripComments(raw);
        if (src.includes('launchPersistentContext')) {
          violations.push(file);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Only packages/runtime/launch.js may call launchPersistentContext. Violations:\n${violations.join('\n')}`
    );
  });
});

describe('Invariant 6: resolve.js is the single browser resolution entry point', () => {
  const RUNTIME_DIR = join(REPO_ROOT, 'packages', 'runtime');

  test('launch.js imports from resolve.js (not config.js for resolution)', async () => {
    const src = await readSrc(join(RUNTIME_DIR, 'launch.js'));
    assert.ok(src.includes("from './resolve.js'"), 'launch.js must import from ./resolve.js');
    // Must NOT import findChromiumPath from config.js
    assert.ok(
      !src.includes('findChromiumPath'),
      'launch.js must not use findChromiumPath from config.js'
    );
  });

  test('config.js findChromiumPath delegates to resolve.js', async () => {
    const src = await readSrc(join(RUNTIME_DIR, 'config.js'));
    assert.ok(
      src.includes('resolveChromium') || src.includes("from './resolve.js'"),
      'config.js findChromiumPath must delegate to resolve.js'
    );
  });

  test('MCP tools do not import resolve.js directly', async () => {
    const files = await jsFiles(MCP_TOOLS_DIR);
    const violations = await Promise.all(
      files.map(async file => {
        const src = await readSrc(file);
        return src.includes('resolve.js') ? file : null;
      })
    ).then(results => results.filter(Boolean));

    assert.deepEqual(
      violations,
      [],
      `MCP tools must not import resolve.js directly — access via checkBrowser(). Violations:\n${violations.join('\n')}`
    );
  });
});

// Recursive directory walker
async function getAllJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const results = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...(await getAllJsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

// Strip line comments and block comments before matching
// to avoid false positives from documentation strings.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/[^\n]*/g, ''); // line comments
}
