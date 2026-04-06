/**
 * Browser detection tests - resolveBrowserPath(), findChromiumPath(), checkBrowser()
 *
 * Run: node --test tests/node/runtime/browser-detection.test.js
 *
 * Unit tests inject finders directly into resolveBrowserPath - no module mocking needed.
 * Smoke tests run against the real system.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { resolveBrowserPath, findChromiumPath } from '../../../packages/runtime/config.js';
import { checkBrowser } from '../../../packages/runtime/launch.js';
import { BrowserNotFoundError } from '../../../packages/runtime/index.js';

// ── Unit: resolveBrowserPath priority order ───────────────────────────────────

describe('resolveBrowserPath', () => {
  test('returns first finder result', async () => {
    const result = await resolveBrowserPath([
      async () => '/fake/chrome',
      async () => '/other/chrome',
    ]);
    assert.strictEqual(result, '/fake/chrome');
  });

  test('skips null and falls through to next finder', async () => {
    const result = await resolveBrowserPath([async () => null, async () => '/fallback/chrome']);
    assert.strictEqual(result, '/fallback/chrome');
  });

  test('skips throwing finder and falls through', async () => {
    const result = await resolveBrowserPath([
      async () => {
        throw new Error('unavailable');
      },
      async () => '/fallback/chrome',
    ]);
    assert.strictEqual(result, '/fallback/chrome');
  });

  test('returns null when all finders return null', async () => {
    const result = await resolveBrowserPath([async () => null, async () => null]);
    assert.strictEqual(result, null);
  });

  test('returns null when all finders throw', async () => {
    const result = await resolveBrowserPath([
      async () => {
        throw new Error('a');
      },
      async () => {
        throw new Error('b');
      },
    ]);
    assert.strictEqual(result, null);
  });

  test('returns null for empty finders array', async () => {
    const result = await resolveBrowserPath([]);
    assert.strictEqual(result, null);
  });
});

// ── Smoke: real system ────────────────────────────────────────────────────────

describe('findChromiumPath smoke (real system)', () => {
  test('returns string or null — never throws', async () => {
    const result = await findChromiumPath();
    assert.ok(result === null || typeof result === 'string', `unexpected: ${typeof result}`);
  });

  test('returned path exists on disk when non-null', async () => {
    const result = await findChromiumPath();
    if (result !== null) {
      assert.ok(existsSync(result), `path does not exist: ${result}`);
    }
  });
});

describe('checkBrowser smoke (real system)', () => {
  test('resolves or throws BrowserNotFoundError — never hangs', async () => {
    const result = await checkBrowser().catch(e => e);
    if (result instanceof BrowserNotFoundError) {
      assert.ok(
        result.message.includes('szkrabok doctor install'),
        `expected doctor install hint:\n${result.message}`
      );
      if (result.candidates) {
        assert.ok(Array.isArray(result.candidates), 'candidates must be array');
        for (const c of result.candidates) {
          assert.ok('source' in c, `candidate missing source: ${JSON.stringify(c)}`);
          assert.ok('ok' in c, `candidate missing ok: ${JSON.stringify(c)}`);
        }
      }
    } else {
      assert.strictEqual(typeof result, 'string', 'resolved path must be a string');
    }
  });
});
