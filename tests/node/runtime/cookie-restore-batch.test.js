/**
 * Cookie restore batch failure — one malformed cookie must not drop the rest.
 *
 * launch() restores saved cookies via a single context.addCookies(allCookies)
 * call. Real Playwright rejects the whole batch if any one cookie is invalid
 * (e.g. expired, bad domain) — that must not cost the entire saved cookie jar.
 *
 * Uses a _launchImpl seam - no real browser launched.
 *
 * Run: node --test tests/node/runtime/cookie-restore-batch.test.js
 */

import { test, describe, before, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let sessionsDir;

before(async () => {
  sessionsDir = await mkdtemp(join(tmpdir(), 'szkrabok-cookie-restore-sessions-'));
  process.env.SZKRABOK_SESSIONS_DIR = sessionsDir;
  const { initConfig } = await import('../../../packages/runtime/config.js');
  await initConfig([]);
});

after(async () => {
  delete process.env.SZKRABOK_SESSIONS_DIR;
  await rm(sessionsDir, { recursive: true, force: true });
});

afterEach(async () => {
  const pool = await import('../../../packages/runtime/pool.js');
  for (const e of pool.list()) {
    if (e.id.includes('-cookierestore-')) pool.remove(e.id);
  }
});

let _seq = 0;
const uid = prefix => `${prefix}-cookierestore-${++_seq}`;

const makeTemplateDir = async name => {
  const dir = join(sessionsDir, name, 'profile');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'Preferences'), '{}');
  return dir;
};

/**
 * Fake context whose addCookies rejects the whole batch if it contains a
 * cookie named "bad" — mirrors Playwright's real all-or-nothing behaviour.
 * Tracks which cookies were actually applied (i.e. calls that didn't throw).
 */
const makeCtxWithFlakyCookies = applied => {
  const page = { isClosed: () => false, url: () => 'about:blank' };
  return {
    _closed: false,
    close: async () => {},
    storageState: async () => ({ cookies: [], origins: [] }),
    browser: () => ({}),
    pages: () => [page],
    newPage: async () => page,
    addCookies: async cookies => {
      if (cookies.some(c => c.name === 'bad')) {
        throw new Error('Invalid cookie in batch: bad');
      }
      applied.push(...cookies.map(c => c.name));
    },
    addInitScript: async () => {},
    on: () => {},
  };
};

const makeLaunchImpl = (port, applied) => async userDataDir => {
  await writeFile(join(userDataDir, 'DevToolsActivePort'), `${port}\n/devtools/browser/mock\n`);
  return makeCtxWithFlakyCookies(applied);
};

describe('cookie restore — one bad cookie must not drop the rest', () => {
  beforeEach(async () => {
    const { _resetGcForTesting } = await import('../../../packages/runtime/launch.js');
    _resetGcForTesting();
  });

  test('good cookies are restored and the bad one is skipped, not silently dropped or retried into passing', async () => {
    const { launch } = await import('../../../packages/runtime/launch.js');
    const storage = await import('../../../packages/runtime/storage.js');

    const profile = uid('mixed-cookies');
    await makeTemplateDir(profile);
    await storage.saveMeta(profile, { sessionName: profile, created: Date.now() });
    await storage.saveState(profile, {
      cookies: [
        { name: 'good', value: '1', domain: 'example.com', path: '/' },
        { name: 'bad', value: '2', domain: 'example.com', path: '/' },
      ],
      origins: [],
    });

    const applied = [];
    console.log('cookie-restore step 1: launch({ profile }) with a batch containing a bad cookie');
    const handle = await launch({
      profile,
      reuse: false,
      _launchImpl: makeLaunchImpl(19999, applied),
    });
    try {
      console.log('cookie-restore step 2: applied cookies =', applied);
      // Positive: the good cookie must survive the bad one's batch failure.
      assert.ok(
        applied.includes('good'),
        `expected the good cookie to be restored despite the bad one, applied=${JSON.stringify(applied)}`
      );
      // Negative: the bad cookie must still fail — this guards against a
      // sloppy fix (e.g. swallowing addCookies errors entirely) that would
      // make the positive assertion pass without actually isolating failures.
      assert.ok(
        !applied.includes('bad'),
        `expected the bad cookie to be skipped, not silently accepted, applied=${JSON.stringify(applied)}`
      );
      assert.deepStrictEqual(
        applied,
        ['good'],
        'exactly the good cookie should be restored, nothing more or less'
      );
    } finally {
      await handle.close();
    }
  });
});
