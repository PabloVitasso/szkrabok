/**
 * restoreLocalStorage (packages/runtime/launch.js): best-effort per origin.
 * One unreachable origin must not abort the launch (example-com e2e failure,
 * hardening host run 2026-10-24). Fake context, no browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreLocalStorage } from '../../packages/runtime/launch.js';

const fakeContext = ({ failOrigins = [], failEvaluate = false } = {}) => {
  const calls = { goto: [], evaluate: 0, closed: false };
  const page = {
    goto: async url => {
      calls.goto.push(url);
      if (failOrigins.some(o => url.startsWith(o))) {
        throw new Error('page.goto: Timeout 10000ms exceeded.');
      }
    },
    evaluate: async () => {
      calls.evaluate++;
      if (failEvaluate) throw new Error('Execution context was destroyed');
    },
    close: async () => {
      calls.closed = true;
    },
  };
  return { context: { newPage: async () => page }, calls };
};

const item = [{ name: 'k', value: 'v' }];

test('a failing origin is skipped; later origins are still restored', async () => {
  const { context, calls } = fakeContext({ failOrigins: ['https://slow.test'] });
  const restored = await restoreLocalStorage(
    context,
    [
      { origin: 'https://slow.test', localStorage: item },
      { origin: 'https://ok.test', localStorage: item },
    ],
    'p'
  );
  assert.equal(restored, 1);
  assert.deepEqual(calls.goto, ['https://slow.test/favicon.ico', 'https://ok.test/favicon.ico']);
  assert.equal(calls.evaluate, 1);
  assert.equal(calls.closed, true);
});

test('origins without items are not visited; no page opened', async () => {
  const { context, calls } = fakeContext();
  const restored = await restoreLocalStorage(
    context,
    [
      { origin: 'https://empty.test', localStorage: [] },
      { origin: 'https://none.test' },
    ],
    'p'
  );
  assert.equal(restored, 0);
  assert.deepEqual(calls.goto, []);
  assert.equal(calls.closed, false, 'no page is opened when nothing needs restoring');
});

test('the page is closed even when every origin fails', async () => {
  const { context, calls } = fakeContext({ failOrigins: ['https://'] });
  const restored = await restoreLocalStorage(
    context,
    [{ origin: 'https://a.test', localStorage: item }],
    'p'
  );
  assert.equal(restored, 0);
  assert.equal(calls.closed, true);
});

test('an evaluate failure is skipped like a goto failure', async () => {
  const { context, calls } = fakeContext({ failEvaluate: true });
  const restored = await restoreLocalStorage(
    context,
    [
      { origin: 'https://a.test', localStorage: item },
      { origin: 'https://b.test', localStorage: item },
    ],
    'p'
  );
  assert.equal(restored, 0);
  assert.equal(calls.evaluate, 2);
  assert.equal(calls.closed, true);
});

test('missing origins list is a no-op', async () => {
  const { context, calls } = fakeContext();
  assert.equal(await restoreLocalStorage(context, undefined, 'p'), 0);
  assert.deepEqual(calls.goto, []);
});
