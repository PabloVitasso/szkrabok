/**
 * guardUserAgentPlugin (packages/runtime/stealth.js).
 *
 * The real user-agent-override evasion drops the promise from
 * page._client().send() in onPageCreated. On a page that closed first, that
 * rejection was unhandled and killed the direct rebrowser.spec.js run
 * (hardening host rerun 2026-10-24). Fake page, no browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import UserAgentOverride from 'puppeteer-extra-plugin-stealth/evasions/user-agent-override/index.js';
import { guardUserAgentPlugin } from '../../packages/runtime/stealth.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

const closedError = () => new Error('cdpSession.send: Target page, context or browser has been closed');

// Shaped like playwright-extra's page shim: _client is a function.
const fakePage = ({ sendFails }) => {
  const sent = [];
  const page = {
    browser: () => ({
      userAgent: async () => UA,
      version: async () => 'Chrome/145.0.0.0',
    }),
    _client: () => ({
      send: async (method, params) => {
        sent.push({ method, params });
        if (sendFails) throw closedError();
        return { ok: true };
      },
      on: () => {},
    }),
  };
  return { page, sent };
};

// Collects unhandled rejections while fn runs, plus a few turns after it.
const unhandledDuring = async fn => {
  const seen = [];
  const onUnhandled = reason => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  await fn();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  process.off('unhandledRejection', onUnhandled);
  return seen;
};

const guarded = () => guardUserAgentPlugin(UserAgentOverride({ userAgent: UA, maskLinux: true }));

test('real plugin, closed target: send fails but nothing is unhandled', async () => {
  const plugin = guarded();
  const { page, sent } = fakePage({ sendFails: true });
  const seen = await unhandledDuring(() => plugin.onPageCreated(page));
  assert.deepEqual(seen, []);
  assert.equal(sent.length, 1, 'the plugin really reached send (the guarded path ran)');
  assert.equal(sent[0].method, 'Network.setUserAgentOverride');
});

test('the skip log names the page; a throwing url() cannot break the guard', async t => {
  // log() writes through console.error (packages/runtime/logger.js).
  const lines = [];
  t.mock.method(console, 'error', (...a) => lines.push(a.join(' ')));
  const plugin = guarded();
  const { page } = fakePage({ sendFails: true });
  page.url = () => 'https://popup.test/';
  await plugin.onPageCreated(page);
  const { page: page2 } = fakePage({ sendFails: true });
  page2.url = () => {
    throw new Error('url boom');
  };
  const seen = await unhandledDuring(() => plugin.onPageCreated(page2));
  assert.deepEqual(seen, []);
  const skipped = lines.filter(l => l.includes('skipped on'));
  assert.ok(skipped.some(l => l.includes('https://popup.test/')), skipped.join('\n'));
  assert.ok(skipped.some(l => l.includes('unknown page')), skipped.join('\n'));
});

test('real plugin, open target: the override is still sent unchanged', async () => {
  const plugin = guarded();
  const { page, sent } = fakePage({ sendFails: false });
  await plugin.onPageCreated(page);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params.userAgent, UA);
  assert.ok(Array.isArray(sent[0].params.userAgentMetadata.brands));
});

test('the wrapped hook stays an AsyncFunction (playwright-extra only catches those)', () => {
  assert.equal(guarded().onPageCreated.constructor.name, 'AsyncFunction');
});

test('a failure elsewhere in the hook still rejects, so onPluginError gets it', async () => {
  const plugin = guardUserAgentPlugin(UserAgentOverride({ maskLinux: true }));
  const page = {
    browser: () => ({
      userAgent: async () => {
        throw closedError();
      },
    }),
    _client: () => ({ send: async () => ({}) }),
  };
  await assert.rejects(() => plugin.onPageCreated(page), /has been closed/);
});

test('non-function _client (puppeteer shape) is supported', async () => {
  const plugin = guarded();
  const sent = [];
  const page = {
    browser: () => ({ userAgent: async () => UA, version: async () => 'Chrome/145.0.0.0' }),
    _client: {
      send: async method => {
        sent.push(method);
        throw closedError();
      },
    },
  };
  const seen = await unhandledDuring(() => plugin.onPageCreated(page));
  assert.deepEqual(seen, []);
  assert.deepEqual(sent, ['Network.setUserAgentOverride']);
});

// ── wiring: enhanceWithStealth never loads an unguarded copy ─────────────────
// playwright-extra skips a dependency whose name is already registered, so with
// the override enabled the guarded copy shadows the stealth one. The gap is the
// override disabled while an `evasions` entry asks for it: then StealthPlugin
// would load its own, unguarded copy.

const pluginsFor = async (t, toml) => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { chromium } = await import('playwright');
  const { initConfig } = await import('../../packages/runtime/config.js');
  const { enhanceWithStealth } = await import('../../packages/runtime/stealth.js');

  const dir = mkdtempSync(join(tmpdir(), 'ua-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'szkrabok.config.toml');
  writeFileSync(configPath, toml);
  initConfig([], { explicitConfigPath: configPath });

  const enhanced = enhanceWithStealth(chromium, { userAgent: UA });
  await enhanced.plugins.resolveDependencies();
  return enhanced.plugins._plugins;
};

const uaPluginsFor = async (t, toml) =>
  (await pluginsFor(t, toml)).filter(p => p.name === 'stealth/evasions/user-agent-override');

const EVASION_ON = '[puppeteer-extra-plugin-stealth.evasions]\n"user-agent-override" = true\n';

test('enhanceWithStealth: override enabled → exactly one UA plugin, the guarded one', async t => {
  const ua = await uaPluginsFor(t, EVASION_ON);
  assert.equal(ua.length, 1);
  assert.ok(Object.hasOwn(ua[0], 'onPageCreated'), 'guarded (own onPageCreated)');
});

test('enhanceWithStealth: override disabled + evasions entry → no UA plugin at all', async t => {
  const ua = await uaPluginsFor(
    t,
    EVASION_ON + '[puppeteer-extra-plugin-stealth."user-agent-override"]\nenabled = false\n'
  );
  assert.equal(ua.length, 0, 'the dedicated enabled=false wins; no unguarded copy loads');
});

// Before the fix the entry re-added the evasion, and resolveDependencies threw
// "Plugin dependency not found" (stealth has no evasions/user-data-dir), so the
// launch failed. The separate puppeteer-extra-plugin-user-data-dir is covered
// by the USER_PREFERENCES_STUB tests below.
test('enhanceWithStealth: an evasions entry cannot re-enable the user-data-dir evasion', async t => {
  const plugins = await pluginsFor(
    t,
    '[puppeteer-extra-plugin-stealth.evasions]\n"user-data-dir" = true\n'
  );
  assert.ok(plugins.length > 0, 'stealth evasions resolved');
  assert.equal(
    plugins.some(p => p.name === 'stealth/evasions/user-data-dir'),
    false
  );
});

// ── USER_PREFERENCES_STUB: the Puppeteer-only profile plugins never load ──────
// user-agent-override → user-preferences → user-data-dir. Without the stub,
// user-data-dir's beforeLaunch makes a /tmp/puppeteer_dev_profile-* dir and
// sets options.userDataDir, which launchPersistentContext ignores.

test('enhanceWithStealth: user-preferences is the stub; user-data-dir never loads', async t => {
  const { USER_PREFERENCES_STUB } = await import('../../packages/runtime/stealth.js');
  const plugins = await pluginsFor(t, EVASION_ON);
  const prefs = plugins.filter(p => p.name === 'user-preferences');
  assert.equal(prefs.length, 1);
  assert.equal(prefs[0], USER_PREFERENCES_STUB);
  assert.equal(
    plugins.some(p => p.name === 'user-data-dir'),
    false
  );
});

test('enhanceWithStealth: beforeLaunch leaves options without a temp userDataDir', async t => {
  const { chromium } = await import('playwright');
  const { enhanceWithStealth } = await import('../../packages/runtime/stealth.js');
  await pluginsFor(t, EVASION_ON);
  const enhanced = enhanceWithStealth(chromium, { userAgent: UA });
  await enhanced.plugins.resolveDependencies();
  // `args` as in a real launch: navigator.webdriver's beforeLaunch needs it, and
  // a throw there would stop the dispatch before user-data-dir ever ran.
  const options = { headless: true, args: [] };
  const errors = [];
  enhanced.plugins.onPluginError = (plugin, method, err) => errors.push(`${plugin.name}: ${err.message}`);
  const result = (await enhanced.plugins.dispatchBlocking('beforeLaunch', options)) || options;
  t.after(async () => {
    if (!result.userDataDir) return;
    const { rmSync } = await import('node:fs');
    rmSync(result.userDataDir, { recursive: true, force: true });
  });
  assert.deepEqual(errors, [], 'every beforeLaunch hook ran');
  assert.equal(result.userDataDir, undefined);
});
