// UA-CH GREASE brands (packages/runtime/stealth-evasions/ua-brands.js) and the
// greasy-brands patch that injects it into coreBundle.js
// (packages/runtime/greasy-brands-patch.js, scripts/apply-greasy-brands.js).
//
// Expected lists are published Sec-CH-UA headers of real Google Chrome per
// milestone (recalled — one binary cannot cover other milestones; they agree
// with Chromium's source). The GREASE derivation and the fullVersionList form
// are captured ground truth: see CAPTURED_145 (Google Chrome for Testing
// 145.0.7632.46, 2026-10-31). The bundle tests run Playwright's own
// _updateUserAgent from the installed bundle with a fake CDP client, so they
// check behavior, not just a marker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { greasedBrands, chromeMajor } from '../../packages/runtime/stealth-evasions/ua-brands.js';
import { PATCH_FILE } from '../../packages/runtime/patch-check.js';
import {
  GREASY_BRANDS_MARKER,
  SHARED_WORKER_UA_MARKER,
  injectGreasyBrands,
  stripGreasyBrands,
} from '../../packages/runtime/greasy-brands-patch.js';

const ua = major =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;

// Sec-CH-UA as published for real Chrome, in header order.
const REAL_CHROME = {
  120: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  124: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  126: '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  129: '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
  131: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  138: '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
};

const header = brands => brands.map(b => `"${b.brand}";v="${b.version}"`).join(', ');

// Captured 2026-10-31 from Google Chrome for Testing 145.0.7632.46 (Linux,
// headless, no UA override anywhere). Chromium-branded build: no
// "Google Chrome" entry, so this is ground truth for the GREASE derivation and
// the fullVersionList form (Q1), not for the 3-brand ordering.
const CAPTURED_145 = {
  brands: [
    { brand: 'Chromium', version: '145' },
    { brand: 'Not:A-Brand', version: '99' },
  ],
  fullVersionList: [
    { brand: 'Chromium', version: '145.0.7632.46' },
    { brand: 'Not:A-Brand', version: '99.0.0.0' },
  ],
  secChUa: '"Chromium";v="145", "Not:A-Brand";v="99"',
};

test('captured Chrome 145: GREASE entry matches the greasedBrands derivation', () => {
  const grease = greasedBrands(145).find(b => !['Chromium', 'Google Chrome'].includes(b.brand));
  const captured = CAPTURED_145.brands.find(b => b.brand === 'Not:A-Brand');
  assert.deepEqual(grease, captured);
});

test('captured Chrome 145 fullVersionList: Q1 settled — GREASE is <greaseVersion>.0.0.0, others get the full version', () => {
  const full = greasedBrands(145, '145.0.7632.46');
  for (const entry of CAPTURED_145.fullVersionList) {
    assert.deepEqual(full.find(b => b.brand === entry.brand), entry);
  }
});

for (const [major, expected] of Object.entries(REAL_CHROME)) {
  test(`greasedBrands(${major}) matches real Chrome Sec-CH-UA`, () => {
    assert.equal(header(greasedBrands(Number(major))), expected);
  });
}

// Recalled form, now backed by the CAPTURED_145 fullVersionList above.
test('full version form: GREASE gets .0.0.0, Chrome brands get the full version', () => {
  assert.deepEqual(greasedBrands(131, '131.0.6778.86'), [
    { brand: 'Google Chrome', version: '131.0.6778.86' },
    { brand: 'Chromium', version: '131.0.6778.86' },
    { brand: 'Not_A Brand', version: '24.0.0.0' },
  ]);
});

test('chromeMajor', () => {
  assert.equal(chromeMajor(ua(145)), 145);
  assert.equal(
    chromeMajor('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'),
    null
  );
  assert.equal(chromeMajor(undefined), null);
});

// ── patched coreBundle.js: Playwright's own _updateUserAgent ─────────────────

const require = createRequire(import.meta.url);
const bundle = readFileSync(
  join(require.resolve('playwright-core/package.json'), '..', PATCH_FILE),
  'utf8'
);

// Source from `start` up to and including the first line that is exactly `close`.
const sliceFrom = (start, close) => {
  const at = bundle.indexOf(start);
  assert.ok(at !== -1, `${start} not found in ${PATCH_FILE}`);
  const end = bundle.indexOf(`\n${close}\n`, at);
  return bundle.slice(at, end + close.length + 1);
};

const calculateUserAgentMetadata = new Function(
  `${sliceFrom('function calculateUserAgentMetadata(options) {', '}')}\nreturn calculateUserAgentMetadata;`
)();
const method = sliceFrom('async _updateUserAgent() {', '      }');
const AsyncFunction = (async () => {}).constructor;
const updateUserAgent = new AsyncFunction(
  'calculateUserAgentMetadata',
  method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'))
);

const sentMetadata = async options => {
  const sent = [];
  const crPageSession = {
    _crPage: { _browserContext: { _options: options } },
    _client: { send: async (m, params) => sent.push({ m, params }) },
  };
  await updateUserAgent.call(crPageSession, calculateUserAgentMetadata);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].m, 'Emulation.setUserAgentOverride');
  return sent[0].params.userAgentMetadata;
};

test('patched _updateUserAgent sends greased brands for a Chrome UA', async () => {
  const meta = await sentMetadata({ userAgent: ua(131), locale: 'en-US' });
  assert.equal(header(meta.brands), REAL_CHROME[131]);
  assert.equal(meta.platform, 'Windows');
});

test('patched _updateUserAgent sends fullVersionList/fullVersion/bitness, not the binary build', async () => {
  const meta = await sentMetadata({ userAgent: ua(131), locale: 'en-US' });
  assert.deepEqual(meta.fullVersionList, greasedBrands(131, '131.0.0.0'));
  assert.equal(meta.fullVersion, '131.0.0.0');
  assert.equal(meta.bitness, '64');
});

test('patched _updateUserAgent leaves metadata alone without a UA override', async () => {
  assert.equal(await sentMetadata({ locale: 'en-US' }), undefined);
});

// ── injector: strip / inject / replace ───────────────────────────────────────

test('installed bundle carries exactly one current greasy-brands block', () => {
  assert.ok(bundle.includes(GREASY_BRANDS_MARKER));
  assert.equal(bundle.split('szkrabok:greasy-brands rev=').length, 2);
});

test('installed bundle carries the shared-worker UA block at all three hooks', () => {
  assert.ok(bundle.includes(SHARED_WORKER_UA_MARKER));
  assert.equal(bundle.split(SHARED_WORKER_UA_MARKER).length, 4);
});

test('inject is idempotent; strip undoes it exactly', () => {
  assert.equal(injectGreasyBrands(bundle), bundle);
  const stripped = stripGreasyBrands(bundle);
  assert.ok(!stripped.includes('szkrabok:greasy-brands'));
  assert.equal(injectGreasyBrands(stripped), bundle);
});

test('a block with another rev is replaced, not stacked', () => {
  const stale = bundle.replace(GREASY_BRANDS_MARKER, 'szkrabok:greasy-brands rev=000000000000');
  assert.ok(!stale.includes(GREASY_BRANDS_MARKER));
  assert.equal(injectGreasyBrands(stale), bundle);
});

test('a core without calculateUserAgentMetadata fails loudly', () => {
  assert.throws(() => injectGreasyBrands('// some other bundle\n'), /calculateUserAgentMetadata/);
});

test('the block lands before the metadata return, not an early return', () => {
  const src = [
    'function calculateUserAgentMetadata(options) {',
    '  const ua = options.userAgent;',
    '  if (!ua) {',
    '    return undefined;',
    '  }',
    '  const metadata = {',
    '    mobile: !!options.isMobile',
    '  };',
    '  return metadata;',
    '}',
    '',
  ].join('\n');
  const calc = new Function(`${injectGreasyBrands(src)}\nreturn calculateUserAgentMetadata;`)();
  assert.equal(header(calc({ userAgent: ua(131) }).brands), REAL_CHROME[131]);
  assert.equal(calc({}), undefined);
});
