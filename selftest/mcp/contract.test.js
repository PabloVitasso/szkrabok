/**
 * Phase 5.3 — MCP contract tests.
 *
 * Uses static import analysis to enforce boundary invariants.
 * No browser launched. Runs fast.
 *
 * Run:
 *   node --test selftest/mcp/contract.test.js
 *
 * Invariants verified:
 * 1. No MCP tool file calls chromium.launch or chromium.launchPersistentContext
 * 2. Every session open in MCP goes through runtime.launch()
 * 3. Pool access in MCP tools comes via @szkrabok/runtime (not direct import of pool internals)
 * 4. automation/fixtures.js does not import stealth internals
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const MCP_TOOLS_DIR = join(REPO_ROOT, 'src', 'tools');
const AUTOMATION_DIR = join(REPO_ROOT, 'automation');

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
    const violations = [];

    for (const file of files) {
      const raw = await readSrc(file);
      // Match chromium.launch( or chromium.launchPersistentContext( — excluding comments
      if (/chromium\s*\.\s*launch/i.test(stripComments(raw))) {
        violations.push(file);
      }
    }

    assert.deepEqual(
      violations,
      [],
      `MCP tool files must not call chromium.launch*(). Violations:\n${violations.join('\n')}`
    );
  });
});

describe('Invariant 2: session.open delegates to runtime.launch', () => {
  test('szkrabok_session.js imports from @szkrabok/runtime', async () => {
    const src = await readSrc(join(MCP_TOOLS_DIR, 'szkrabok_session.js'));
    assert.ok(
      src.includes("from '@szkrabok/runtime'"),
      "szkrabok_session.js must import from '@szkrabok/runtime'"
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
    const violations = [];

    for (const file of files) {
      const src = await readSrc(file);
      if (/@szkrabok\/runtime\//.test(src)) {
        violations.push(file);
      }
    }

    assert.deepEqual(
      violations,
      [],
      `MCP tools must not import @szkrabok/runtime subpaths — use the public API only. Violations:\n${violations.join('\n')}`
    );
  });
});

describe('Invariant 4: automation/fixtures.js has no stealth imports', () => {
  test('fixtures.js does not import stealth internals', async () => {
    const src = await readSrc(join(AUTOMATION_DIR, 'fixtures.js'));
    const stealthPatterns = ['szkrabok_stealth', 'playwright-extra', 'puppeteer-extra-plugin-stealth'];
    for (const pattern of stealthPatterns) {
      assert.ok(
        !src.includes(pattern),
        `automation/fixtures.js must not import "${pattern}"`
      );
    }
  });

  test('fixtures.js does not call chromium.launch', async () => {
    const raw = await readSrc(join(AUTOMATION_DIR, 'fixtures.js'));
    assert.ok(
      !/chromium\s*\.\s*launch/.test(stripComments(raw)),
      'automation/fixtures.js must not call chromium.launch*()'
    );
  });

  test('fixtures.js imports from @szkrabok/runtime', async () => {
    const src = await readSrc(join(AUTOMATION_DIR, 'fixtures.js'));
    assert.ok(
      src.includes("from '@szkrabok/runtime'"),
      "automation/fixtures.js must import from '@szkrabok/runtime'"
    );
  });
});

describe('Invariant 5: packages/runtime is the only launch site', () => {
  test('only packages/runtime/launch.js contains launchPersistentContext', async () => {
    const searchDirs = [
      join(REPO_ROOT, 'src'),
      join(REPO_ROOT, 'automation'),
      join(REPO_ROOT, 'selftest'),
      join(REPO_ROOT, 'mcp-client'),
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
    .replace(/\/\/[^\n]*/g, '');       // line comments
}
