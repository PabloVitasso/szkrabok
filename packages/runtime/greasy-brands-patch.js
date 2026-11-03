// greasy-brands-patch.js — szkrabok's own playwright-core patch: UA-CH brands
// and the shared-worker User-Agent override.
//
// Separate from the rebrowser patches (patches/*.patch, patch-package), so it
// works on any playwright-core bundle: stock, ours, or a rebrowser drop-in.
//
// Two hooks:
//   calculateUserAgentMetadata() in coreBundle.js. Playwright builds the
//   metadata of every Emulation.setUserAgentOverride there (pages, its own
//   re-sends, service workers) and never sets brands, so Chromium keeps the
//   binary's own brand list whatever version the user agent claims. The block
//   sets the list Chrome of the UA's major version sends
//   (stealth-evasions/ua-brands.js), plus fullVersionList/fullVersion/bitness
//   so Sec-CH-UA-Full-Version-List does not leak the binary build.
//
//   CRBrowser._onAttachedToTarget(). Playwright handles page and service_worker
//   only; shared_worker falls through to session2.detach(), which reverts the
//   per-target Emulation override. The block keeps the shared-worker session
//   attached, sends the same metadata, and releases it on target detach.
//
// The marker is a static revision. A hash of the block would be unstable: the
// Playwright test runner transforms modules, so greasedBrands.toString()
// differs from the postinstall process and the same source would look stale.
// Bump REV/SW_REV when the block changes; injectGreasyBrands replaces any old
// rev. stripGreasyBrands runs before patch-package, whose hunks are
// line-position based.

import { greasedBrands } from './stealth-evasions/ua-brands.js';

const BEGIN = '// ── szkrabok:greasy-brands';
const END = '// ── end szkrabok:greasy-brands ──';
const SW_BEGIN = '// ── szkrabok:shared-worker-ua';
const SW_END = '// ── end szkrabok:shared-worker-ua ──';

const REV = '2';
const SW_REV = '1';

const FN_HEAD = /function calculateUserAgentMetadata\((\w+)\) \{/;
// The metadata object (`const metadata = { mobile: … }`) and its own return,
// not an early `return undefined;`.
const METADATA = /\b(?:const|let|var) (\w+)(?:: [\w.]+)? = \{\s*mobile:/;
const returnOf = name => new RegExp(`^([ \\t]*)return ${name};$`, 'm');

const body = (options, metadata) =>
  `{
  const _szkChrome = /Chrome\\/([\\d.]+)/.exec(${options}.userAgent || '');
  if (_szkChrome) {
    const _szkMajor = parseInt(_szkChrome[1], 10);
    const _szkFull = _szkChrome[1];
    const _szkBrands = (${greasedBrands.toString()});
    ${metadata}.brands = _szkBrands(_szkMajor);
    ${metadata}.fullVersionList = _szkBrands(_szkMajor, _szkFull);
    ${metadata}.fullVersion = _szkFull;
    ${metadata}.bitness = '64';
  }
}`;

/** In coreBundle.js only when the current brands block is in place. */
export const GREASY_BRANDS_MARKER = `szkrabok:greasy-brands rev=${REV}`;

/** In coreBundle.js only when the shared-worker block is in place. */
export const SHARED_WORKER_UA_MARKER = `szkrabok:shared-worker-ua rev=${SW_REV}`;

const stripBlock = (src, begin, end) => {
  let out = src;
  for (let at = out.indexOf(begin); at !== -1; at = out.indexOf(begin)) {
    const lineStart = out.lastIndexOf('\n', at) + 1;
    const endAt = out.indexOf(end, at);
    if (endAt === -1) throw new Error(`${begin}: block start without end marker`);
    out = out.slice(0, lineStart) + out.slice(out.indexOf('\n', endAt) + 1);
  }
  return out;
};

/** src without any szkrabok block (any rev). */
export const stripGreasyBrands = src => {
  const withoutBrands = stripBlock(src, BEGIN, END);
  return stripBlock(withoutBrands, SW_BEGIN, SW_END);
};

const SW_ATTACH_ANCHOR = '        if (!context || targetInfo.type === "other" && !treatOtherAsPage) {';
const SW_DETACH_ANCHOR = '      _onDetachedFromTarget(payload) {\n        const targetId = payload.targetId;';
const SW_DISCONNECT_ANCHOR = '        this._serviceWorkers.clear();';

const swBody = {
  attach: [
    'if (targetInfo.type === "shared_worker") {',
    '  const _szkUa = this._userAgent;',
    '  const _szkMeta = calculateUserAgentMetadata({ userAgent: _szkUa });',
    '  (async () => {',
    '    try { await session2.send("Emulation.setUserAgentOverride", { userAgent: _szkUa, userAgentMetadata: _szkMeta }); } catch {}',
    '    try { await session2.send("Runtime.runIfWaitingForDebugger"); } catch {}',
    '  })();',
    '  (this._sharedWorkerSessions ??= new Map()).set(targetInfo.targetId, session2);',
    '  return;',
    '}',
  ],
  detach: [
    'const _szkShared = this._sharedWorkerSessions?.get(targetId);',
    'if (_szkShared) {',
    '  this._sharedWorkerSessions.delete(targetId);',
    '  try { _szkShared.dispose(); } catch {}',
    '  return;',
    '}',
  ],
  disconnect: ['this._sharedWorkerSessions?.clear();'],
};

const insertBlock = (src, lines, rev, anchor, before) => {
  const at = src.indexOf(anchor);
  if (at === -1) throw new Error(`${SW_BEGIN}: anchor not found`);
  const lineStart = src.lastIndexOf('\n', at) + 1;
  const indent = src.slice(lineStart, at);
  const block = [`${SW_BEGIN} rev=${rev} ──`, ...lines, SW_END]
    .map(line => indent + line)
    .join('\n');
  const anchorLineEnd = src.indexOf('\n', at + anchor.length) + 1;
  const insertAt = before ? lineStart : anchorLineEnd;
  return `${src.slice(0, insertAt)}${block}\n${src.slice(insertAt)}`;
};

/**
 * Keep shared-worker CDP sessions attached and apply the UA override.
 * Best-effort across playwright-core versions: if any anchor is absent the core
 * is left untouched, and PATCH_MARKERS reports the missing block.
 */
export const injectSharedWorkerUa = src => {
  const anchors = [SW_ATTACH_ANCHOR, SW_DETACH_ANCHOR, SW_DISCONNECT_ANCHOR];
  if (anchors.some(anchor => !src.includes(anchor))) return src;
  let out = src;
  out = insertBlock(out, swBody.attach, SW_REV, SW_ATTACH_ANCHOR, true);
  out = insertBlock(out, swBody.detach, SW_REV, SW_DETACH_ANCHOR, false);
  out = insertBlock(out, swBody.disconnect, SW_REV, SW_DISCONNECT_ANCHOR, false);
  return out;
};

/** src with the current blocks injected, replacing any other rev. Throws when the metadata hook is missing. */
export const injectGreasyBrands = src => {
  const clean = stripGreasyBrands(src);
  const head = FN_HEAD.exec(clean);
  if (!head) throw new Error('greasy-brands: calculateUserAgentMetadata(options) not found');
  const next = clean.indexOf('\nfunction ', head.index + 1);
  const fnBody = next === -1 ? clean.slice(head.index) : clean.slice(head.index, next);
  const meta = METADATA.exec(fnBody);
  const ret = meta && returnOf(meta[1]).exec(fnBody);
  if (!ret) throw new Error('greasy-brands: metadata return of calculateUserAgentMetadata not found');
  const [, indent] = ret;
  const metadata = meta[1];
  const block = [`${BEGIN} rev=${REV} ──`, ...body(head[1], metadata).split('\n'), END]
    .map(line => indent + line)
    .join('\n');
  const at = head.index + ret.index;
  const withBrands = `${clean.slice(0, at)}${block}\n${clean.slice(at)}`;
  return injectSharedWorkerUa(withBrands);
};
