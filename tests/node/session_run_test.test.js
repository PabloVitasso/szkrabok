/**
 * Unit tests for session_run_test (EX-1 test plan).
 * All I/O is mocked. Each test is fully self-contained.
 *
 * 21 test cases: clone/template lifecycle, navigation policies,
 * failure propagation, templateConflict, enforceLaunchOptionsMatch, workers:1.
 *
 * Removed: EX-1.7-1.9 (postPolicy keep - brittle throwNth counting, better as e2e)
 *          EX-1.19-1.20 (concurrency - withLock only in session_run_test wrapper, not _run)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { _run } from '../../src/tools/session_run_test.js';

// ── Mock factories ─────────────────────────────────────────────────────────────

const SESSION_OPEN = { cdpPort: 9222, isClone: false };

const noopPage = (url = 'about:blank') => ({
  url:  () => url,
  goto: async () => {},
});

/** Spy for sessionOpen - records the single call args. */
const spyOpen = (calls) => async ({ sessionName, launchOptions }) => {
  calls.push({ sessionName, launchOptions });
  return { sessionName, ...SESSION_OPEN };
};

/** Spy for sessionClose - records each { sessionName } call. */
const spyClose = (calls) => async ({ sessionName }) => {
  calls.push({ sessionName });
  return { success: true };
};

/** Spy for run_test - records opts, returns a fixed result. */
const spyRun = (calls, result = {}) => async (opts) => {
  calls.push(opts);
  return { passed: 1, failed: 0, skipped: 0, tests: [], ...result };
};

/**
 * Stateful getSession mock.
 * throwNth: throw on the nth call and every call after (default: 1 = always throw).
 * Pass Infinity to always return a valid session.
 */
const mockGetSession = ({ throwNth = 1 } = {}) => {
  let n = 0;
  return (_name) => {
    n++;
    if (n >= throwNth) {
      const e = new Error(`Session not found: ${_name}`);
      e.code = 'SESSION_NOT_FOUND';
      throw e;
    }
    return { page: noopPage(), ...SESSION_OPEN, configHash: null };
  };
};

/** Spy for cloneFromLive. */
const spyClone = (calls, result = { cloneId: 'allegro#c91' }) =>
  async (name) => { calls.push({ name }); return result; };

/** Config hash mock. */
const mockHash = (h = null) => () => h;

/** Captures console.warn output. */
const captureWarn = (out) => {
  const orig = console.warn;
  console.warn = (...a) => out.push(a.join(' '));
  return () => { console.warn = orig; };
};

// ── Shared minimal deps (no I/O) ───────────────────────────────────────────────

const base = () => ({
  sessionOpen:       spyOpen([]),
  sessionClose:      spyClose([]),
  run_test:          spyRun([]),
  getSession:        mockGetSession({ throwNth: Infinity }),  // always returns
  computeConfigHash: mockHash(),
  cloneFromLive:     spyClone([]),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EX-1 — clone mode', () => {

  test('EX-1.1 sessionOpen called with isClone:true', async () => {
    const calls = [];
    const deps  = { ...base(), sessionOpen: spyOpen(calls), getSession: mockGetSession({ throwNth: 1 }) };
    await _run({ session: { name: 'allegro' }, test: {} }, deps);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].launchOptions?.isClone, true);
  });

  test('EX-1.2 runtimeName from sessionOpen response, logicalName unchanged', async () => {
    const deps = { ...base(), getSession: mockGetSession({ throwNth: 1 }) };
    const result = await _run({ session: { name: 'allegro' }, test: {} }, deps);
    assert.strictEqual(result.session.logicalName, 'allegro');
    assert.strictEqual(result.session.runtimeName,  'allegro');
    assert.strictEqual(result.session.mode, 'clone');
  });

  test('EX-1.3 sessionClose called after test (postPolicy destroy)', async () => {
    const calls = [];
    const deps  = { ...base(), sessionClose: spyClose(calls), getSession: mockGetSession({ throwNth: 1 }) };
    await _run({ session: { name: 'allegro' }, test: {} }, deps);
    assert.deepStrictEqual(calls, [{ sessionName: 'allegro' }]);
  });
});

describe('EX-1 — template mode', () => {

  test('EX-1.4 sessionOpen called without isClone', async () => {
    const calls = [];
    const deps  = { ...base(), sessionOpen: spyOpen(calls) };
    await _run({ session: { name: 'allegro', mode: 'template' }, test: {} }, deps);
    assert.strictEqual(calls.length, 1);
    const lo = calls[0].launchOptions;
    assert.strictEqual(lo !== undefined && 'isClone' in lo, false,
      'isClone must not be present in launchOptions for template mode');
  });

  test('EX-1.5 runtimeName equals logicalName', async () => {
    const result = await _run({ session: { name: 'allegro', mode: 'template' }, test: {} }, base());
    assert.strictEqual(result.session.runtimeName,  'allegro');
    assert.strictEqual(result.session.logicalName, 'allegro');
  });

  test('EX-1.6 sessionClose called after test (postPolicy save)', async () => {
    const calls = [];
    const deps  = { ...base(), sessionClose: spyClose(calls) };
    await _run({ session: { name: 'allegro', mode: 'template' }, test: {} }, deps);
    assert.deepStrictEqual(calls, [{ sessionName: 'allegro' }]);
  });
});

describe('EX-1 — navigation policy', () => {

  // Returns a getSession that always resolves with the given page.
  const withPage = (page) => () => ({ page, ...SESSION_OPEN, configHash: null });

  test('EX-1.10 always: page.goto called with networkidle', async () => {
    let captured;
    const page = { url: () => 'about:blank', goto: async (url, opts) => { captured = { url, opts }; } };
    const deps = { ...base(), getSession: withPage(page) };
    await _run({
      session: { name: 'allegro', mode: 'template', navigation: { policy: 'always', url: 'https://example.com' } },
      test:    {},
    }, deps);
    assert.strictEqual(captured.url, 'https://example.com');
    assert.strictEqual(captured.opts.waitUntil, 'networkidle');
  });

  test('EX-1.11 ifBlank + page blank: goto called', async () => {
    let called = false;
    const page = { url: () => 'about:blank', goto: async () => { called = true; } };
    const deps = { ...base(), getSession: withPage(page) };
    await _run({
      session: { name: 'allegro', mode: 'template', navigation: { policy: 'ifBlank', url: 'https://example.com' } },
      test:    {},
    }, deps);
    assert.strictEqual(called, true);
  });

  test('EX-1.12 ifBlank + page not blank: goto NOT called', async () => {
    let called = false;
    const page = { url: () => 'https://other.com', goto: async () => { called = true; } };
    const deps = { ...base(), getSession: withPage(page) };
    await _run({
      session: { name: 'allegro', navigation: { policy: 'ifBlank', url: 'https://example.com' } },
      test:    {},
    }, deps);
    assert.strictEqual(called, false);
  });

  test('EX-1.13 never: goto NOT called', async () => {
    let called = false;
    const page = { url: () => 'about:blank', goto: async () => { called = true; } };
    const deps = { ...base(), getSession: withPage(page) };
    await _run({ session: { name: 'allegro', navigation: { policy: 'never' } }, test: {} }, deps);
    assert.strictEqual(called, false);
  });

  test('EX-1.14 always + url missing: session error before any I/O', async () => {
    let openCalled = false;
    const deps = { ...base(), sessionOpen: async () => { openCalled = true; return {}; } };
    const result = await _run({
      session: { name: 'allegro', navigation: { policy: 'always' } },
      test:    {},
    }, deps);
    assert.strictEqual(openCalled, false, 'sessionOpen must not be called before URL validation');
    assert.strictEqual(result.phase, 'session');
    assert.ok(result.error.includes('url required'), result.error);
  });
});

describe('EX-1 — failure phase propagation', () => {

  test('EX-1.15 session open failure → phase:session, test not run', async () => {
    let testRun = false;
    const deps = {
      ...base(),
      getSession:  mockGetSession({ throwNth: 1 }),  // template appears closed
      sessionOpen: async () => { throw new Error('open failed'); },
      run_test:    async () => { testRun = true; return {}; },
    };
    const result = await _run({ session: { name: 'allegro' }, test: {} }, deps);
    assert.strictEqual(testRun, false);
    assert.strictEqual(result.phase, 'session');
    assert.ok(result.error.includes('open failed'));
  });

  test('EX-1.16 navigation failure → phase:session, test not run', async () => {
    let testRun = false;
    const page = { url: () => 'about:blank', goto: async () => { throw new Error('nav failed'); } };
    const deps = {
      ...base(),
      getSession: () => ({ page, ...SESSION_OPEN, configHash: null }),
      run_test:   async () => { testRun = true; return {}; },
    };
    const result = await _run({
      session: { name: 'allegro', mode: 'template', navigation: { policy: 'always', url: 'https://example.com' } },
      test:    {},
    }, deps);
    assert.strictEqual(testRun, false);
    assert.strictEqual(result.phase, 'session');
    assert.ok(result.error.includes('nav failed'));
  });

  test('EX-1.17 test failure → postPolicy still runs, error in result.test', async () => {
    // Template mode: getSession always returns (base), run_test throws,
    // postPolicy 'save' calls sessionClose regardless.
    const closeCalls = [];
    const deps = {
      ...base(),
      run_test:     async () => { throw new Error('test failed'); },
      sessionClose: spyClose(closeCalls),
    };
    const result = await _run({ session: { name: 'allegro', mode: 'template' }, test: {} }, deps);
    assert.strictEqual(closeCalls.length, 1, 'sessionClose must run after test failure');
    assert.ok(result.test?.error?.includes('test failed'), String(result.test?.error));
  });

  test('EX-1.18 postPolicy failure → phase:postPolicy, test result included', async () => {
    // Template mode: run_test succeeds, sessionClose throws -> postPolicy error with test data.
    const testResult = { passed: 5, failed: 0, tests: [{ title: 't', status: 'expected' }] };
    const deps = {
      ...base(),
      run_test:     spyRun([], testResult),
      sessionClose: async () => { throw new Error('close failed'); },
    };
    const result = await _run({ session: { name: 'allegro', mode: 'template' }, test: {} }, deps);
    assert.strictEqual(result.phase, 'postPolicy');
    assert.ok(result.error.includes('close failed'));
    assert.strictEqual(result.test.passed, 5);
  });
});

describe('EX-1 — templateConflict', () => {

  test('EX-1.21 fail + template open → session error', async () => {
    const deps = { ...base(), getSession: mockGetSession({ throwNth: Infinity }) };
    const result = await _run({
      session: { name: 'allegro', templateConflict: 'fail' },
      test:    {},
    }, deps);
    assert.strictEqual(result.phase, 'session');
    assert.ok(result.error.includes('open') || result.error.includes('Template'), result.error);
  });

  test('EX-1.22 close-first + template open → sessionClose before sessionOpen', async () => {
    const order = [];
    const deps = {
      ...base(),
      getSession:   mockGetSession({ throwNth: Infinity }),  // template appears open
      sessionClose: async ({ sessionName }) => { order.push(`close-${sessionName}`); return {}; },
      sessionOpen:  async ({ sessionName }) => { order.push(`open-${sessionName}`); return { sessionName }; },
    };
    await _run({
      session: { name: 'allegro', templateConflict: 'close-first' },
      test:    {},
    }, deps);
    const closeIdx = order.indexOf('close-allegro');
    const openIdx  = order.indexOf('open-allegro');
    assert.ok(closeIdx < openIdx, `close(${closeIdx}) must precede open(${openIdx}): ${order}`);
  });

  test('EX-1.23 clone-from-live → cloneFromLive called, template NOT closed', async () => {
    const closeCalls = [];
    const cloneCalls = [];
    const page = noopPage();
    // getSession always returns -> template appears open on first call (templateOpen check).
    const deps = {
      ...base(),
      getSession:    () => ({ page, ...SESSION_OPEN, configHash: null }),
      sessionClose:  spyClose(closeCalls),
      cloneFromLive: spyClone(cloneCalls, { cloneId: 'allegro#c91' }),
    };
    await _run({
      session: { name: 'allegro', templateConflict: 'clone-from-live' },
      test:    {},
    }, deps);
    assert.strictEqual(cloneCalls.length, 1,           'cloneFromLive must be called once');
    assert.strictEqual(cloneCalls[0].name, 'allegro',  'called with template name');
    // Only the clone is destroyed, not the template.
    assert.strictEqual(closeCalls.length, 1);
    assert.strictEqual(closeCalls[0].sessionName, 'allegro#c91',
      'sessionClose must destroy the clone, not the template');
  });
});

describe('EX-1 — enforceLaunchOptionsMatch', () => {

  test('EX-1.24 enforceLaunchOptionsMatch true + mismatch → session error', async () => {
    // Pool entry has configHash: null; computeConfigHash returns 'hash_caller' -> mismatch.
    const deps = {
      ...base(),
      getSession:        () => ({ page: noopPage(), ...SESSION_OPEN, configHash: null }),
      computeConfigHash: mockHash('hash_caller'),
    };
    const result = await _run({
      session: {
        name:                      'allegro',
        mode:                      'template',
        enforceLaunchOptionsMatch:  true,
        launchOptions:             { stealth: true },
      },
      test: {},
    }, deps);
    assert.strictEqual(result.phase, 'session');
    assert.ok(result.error.includes('mismatch'), result.error);
  });

  test('EX-1.25 enforceLaunchOptionsMatch false + mismatch → warn, continue', async () => {
    const warns = [];
    const restore = captureWarn(warns);
    try {
      const deps = {
        ...base(),
        getSession:        () => ({ page: noopPage(), ...SESSION_OPEN, configHash: null }),
        computeConfigHash: mockHash('hash_caller'),
      };
      const result = await _run({
        session: {
          name:                      'allegro',
          mode:                      'template',
          enforceLaunchOptionsMatch:  false,
          launchOptions:             { stealth: true },
        },
        test: {},
      }, deps);
      assert.ok(warns.some(m => m.includes('mismatch') || m.includes('launchOptions')),
        `warn must fire: ${warns}`);
      assert.strictEqual(result.phase, undefined, 'run must complete');
    } finally { restore(); }
  });
});

describe('EX-1 — workers:1 enforcement', () => {

  test('EX-1.26 run_test always called with workers:1 and signalAttach:true', async () => {
    const calls = [];
    const deps  = { ...base(), run_test: spyRun(calls), getSession: mockGetSession({ throwNth: 1 }) };
    await _run({ session: { name: 'allegro' }, test: { spec: 'foo.spec.js' } }, deps);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].workers,      1,    'workers must be 1');
    assert.strictEqual(calls[0].signalAttach, true, 'signalAttach must be true');
  });
});
