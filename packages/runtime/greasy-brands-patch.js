// greasy-brands-patch.js — szkrabok's own playwright-core patch: UA-CH brands.
//
// Separate from the rebrowser patches (patches/*.patch, patch-package), so it
// works on any playwright-core bundle: stock, ours, or a rebrowser drop-in.
//
// Hook: calculateUserAgentMetadata() in coreBundle.js. Playwright builds the
// metadata of every Emulation.setUserAgentOverride there (pages, its own
// re-sends, service workers) and never sets brands, so Chromium keeps the
// binary's own brand list whatever version the user agent claims. The block
// sets the list Chrome of the UA's major version sends (stealth-evasions/ua-brands.js).
//
// The marker carries a hash of the block: a core with a block of another rev
// reads as unpatched, and injectGreasyBrands replaces it. stripGreasyBrands runs
// before patch-package, whose hunks are line-position based.

import { createHash } from 'node:crypto';
import { greasedBrands } from './stealth-evasions/ua-brands.js';

const BEGIN = '// ── szkrabok:greasy-brands';
const END = '// ── end szkrabok:greasy-brands ──';

const FN_HEAD = /function calculateUserAgentMetadata\((\w+)\) \{/;
// The metadata object (`const metadata = { mobile: … }`) and its own return,
// not an early `return undefined;`.
const METADATA = /\b(?:const|let|var) (\w+)(?:: [\w.]+)? = \{\s*mobile:/;
const returnOf = name => new RegExp(`^([ \\t]*)return ${name};$`, 'm');

const body = (options, metadata) =>
  `{
  const _szkChrome = /Chrome\\/(\\d+)/.exec(${options}.userAgent || '');
  if (_szkChrome) ${metadata}.brands = (${greasedBrands.toString()})(parseInt(_szkChrome[1], 10));
}`;

const REV = createHash('sha256').update(body('options', 'metadata')).digest('hex').slice(0, 12);

/** In coreBundle.js only when the current block is in place. */
export const GREASY_BRANDS_MARKER = `szkrabok:greasy-brands rev=${REV}`;

/** src without any greasy-brands block (any rev). */
export const stripGreasyBrands = src => {
  let out = src;
  for (let at = out.indexOf(BEGIN); at !== -1; at = out.indexOf(BEGIN)) {
    const lineStart = out.lastIndexOf('\n', at) + 1;
    const end = out.indexOf(END, at);
    if (end === -1) throw new Error('greasy-brands: block start without end marker');
    out = out.slice(0, lineStart) + out.slice(out.indexOf('\n', end) + 1);
  }
  return out;
};

/** src with the current block injected, replacing any other rev. Throws when the hook is missing. */
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
  return `${clean.slice(0, at)}${block}\n${clean.slice(at)}`;
};
