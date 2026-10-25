// Verifies that all playwright-core patches are applied in node_modules, and
// that the shared check (packages/runtime/patch-check.js) reports a missing
// patch instead of passing silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  PATCH_FILE,
  PATCH_MARKERS,
  missingPatchMarkers,
  patchProblem,
  playwrightCoreRoot,
} from '../../packages/runtime/patch-check.js';

const require = createRequire(import.meta.url);
const pwRoot = join(require.resolve('playwright-core/package.json'), '..');

for (const marker of PATCH_MARKERS) {
  test(`playwright-core patch applied: ${PATCH_FILE} — ${marker}`, () => {
    const missing = missingPatchMarkers(pwRoot) ?? PATCH_MARKERS;
    assert.ok(
      !missing.includes(marker),
      `Missing patch marker "${marker}" in ${PATCH_FILE} — run: node scripts/apply-patches.js`
    );
  });
}

test('playwrightCoreRoot is the playwright-core that playwright loads, and it is patched', () => {
  const root = playwrightCoreRoot();
  assert.ok(root, 'resolved');
  assert.equal(patchProblem(root), null);
});

// A fake playwright-core dir with the given coreBundle.js content (or none).
const fakeRoot = (t, content) => {
  const dir = mkdtempSync(join(tmpdir(), 'pw-patch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (content === undefined) return dir;
  mkdirSync(join(dir, 'lib'));
  writeFileSync(join(dir, PATCH_FILE), content);
  return dir;
};

test('unpatched bundle: every marker reported missing', t => {
  const dir = fakeRoot(t, '// stock playwright-core');
  assert.deepEqual(missingPatchMarkers(dir), [...PATCH_MARKERS]);
  assert.match(patchProblem(dir), new RegExp(`^${PATCH_MARKERS.length}/${PATCH_MARKERS.length} `));
});

test('partly patched bundle: only the absent markers are reported', t => {
  const dir = fakeRoot(t, PATCH_MARKERS.slice(1).join('\n'));
  assert.deepEqual(missingPatchMarkers(dir), [PATCH_MARKERS[0]]);
  assert.match(patchProblem(dir), new RegExp(`^1/${PATCH_MARKERS.length} .*${PATCH_MARKERS[0]}`));
});

test('fully patched bundle: no problem', t => {
  const dir = fakeRoot(t, PATCH_MARKERS.join('\n'));
  assert.deepEqual(missingPatchMarkers(dir), []);
  assert.equal(patchProblem(dir), null);
});

test('no bundle or no playwright-core: reported, never thrown', t => {
  const dir = fakeRoot(t);
  assert.equal(missingPatchMarkers(dir), null);
  assert.match(patchProblem(dir), /not readable/);
  assert.equal(patchProblem(null), 'playwright-core not found');
});

// ── launch() warning: once per process, Chromium only ────────────────────────

const warningsDuring = (t, fn) => {
  // logWarn writes through console.error (packages/runtime/logger.js).
  const lines = [];
  t.mock.method(console, 'error', (...a) => lines.push(a.join(' ')));
  fn();
  return lines.filter(l => l.includes('not stealth-patched'));
};

test('warnIfUnpatched: unpatched → one warning naming the fix, then silent', async t => {
  const { warnIfUnpatched, _resetPatchCheckForTesting } = await import(
    '../../packages/runtime/launch.js'
  );
  _resetPatchCheckForTesting();
  t.after(_resetPatchCheckForTesting);
  const dir = fakeRoot(t, '// stock playwright-core');
  const lines = warningsDuring(t, () => {
    warnIfUnpatched('chromium', dir);
    warnIfUnpatched('chromium', dir);
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /--ignore-scripts/);
});

test('warnIfUnpatched: Firefox and a patched core stay silent', async t => {
  const { warnIfUnpatched, _resetPatchCheckForTesting } = await import(
    '../../packages/runtime/launch.js'
  );
  _resetPatchCheckForTesting();
  t.after(_resetPatchCheckForTesting);
  const unpatched = fakeRoot(t, '// stock playwright-core');
  const patched = fakeRoot(t, PATCH_MARKERS.join('\n'));
  const lines = warningsDuring(t, () => {
    warnIfUnpatched('firefox', unpatched);
    warnIfUnpatched('chromium', patched);
  });
  assert.deepEqual(lines, []);
});

test('launch() and launchClone() both run the check after checkBrowser', async () => {
  const { readFileSync: read } = await import('node:fs');
  const src = read(new URL('../../packages/runtime/launch.js', import.meta.url), 'utf8');
  const wired = src.match(/await checkBrowser\(\);\n\s+warnIfUnpatched\(browserEngine\);/g) ?? [];
  assert.equal(wired.length, 2);
});
