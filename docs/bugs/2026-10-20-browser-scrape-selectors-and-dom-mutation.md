# Bug: browser_scrape — leaf selectors return nothing; scrape mutates the live DOM

**Date:** 2026-10-20
**Reporter:** Pablo Vitasso
**szkrabok version:** 2.1.4 (npx-installed, cache hash 535c3d581cda60c6)
**Environment:** Linux jones2-VirtualBox (Ubuntu 24.04), Node v24.13.1

---

## Summary
telegraphic. `browser_scrape` with `selectors: ["h3"]` returned zero blocks on wp.pl despite 165 h3 elements in the DOM. separately, every scrape call destructively deleted nav/footer/script/style/.ads/#cookies nodes from the live page — subsequent interaction/scrapes ran against a gutted DOM. two bugs, one root shape: selection, exclusion, extraction were three different element sets interacting through descendant traversal.

## severity
high. silent data loss (leaf selectors -> empty, no warning) + live-DOM corruption (scrape is advertised as a read). reproducible on every page.

## environment
- tool: `browser_scrape`
- install: npx -y @pablovitasso/szkrabok, cache path /home/jones2/.npm/_npx/535c3d581cda60c6/
- source: `src/tools/workflow.js`, `scrape` export

## symptoms (evidence)
| probe | result |
|---|---|
| `selectors:["h3"]` wp.pl | 165 roots matched, 0 blocks collected |
| `selectors:["body"]` wp.pl | 1 root, 237 blocks |
| `selectors:["p"]` example.com | 6 roots matched, 0 blocks |
| fixture DOM before → after scrape | nav 1→0, footer 1→0 (mutation) |

reproduces on any page — not cookie-overlay/consent-wall related (overlay text leaked into output instead, exclusion list `nav, footer, script, style, .ads, #cookies` never matched it).

## root cause (old implementation)
```js
targets = querySelectorAll(userSelectors.join(','))        // (a) selection set
  └─ root.querySelectorAll('nav, footer, ...').remove()     // (b) exclusion — DESTRUCTIVE
  └─ root.querySelectorAll('p, li, h1, h2, h3, table')      // (c) extraction — DESCENDANTS ONLY
```
1. matched elements used as *containers*; their own text never collected -> selecting content leaves (`h3`, `p`, `li`, `table`) yields nothing.
2. exclusion via `Element.remove()` on the real page -> lost navigation/footer/styles, dead SPA handlers, broken later interactions.
3. secondary: `h4-h6` dropped from extraction set; `innerText` silently drops `display:none` text; filters (20-char, linkRatio) drop blocks unreported; invalid selector kills whole scrape with raw SyntaxError; nested blocks double-captured.

## contract (now tested)
- `selectors` match content elements OR containers — text is returned for every matching element and everything inside it; omit for auto (main/body)
- blocks in document order; one block per element; nested content merges into its carrier block
- read-only: the live DOM is never mutated (boilerplate is skipped, not removed)
- text is layout-independent, includes `display:none` subtrees, never leaks script/style/noscript
- every dropped candidate is accounted for in `stats.dropped {excluded, tooShort, linkHeavy, duplicate, nested}`
- invalid selector -> `{code: "INVALID_SELECTOR", message}` naming it

## fix
`src/tools/workflow.js` rewrite: staged pipeline (resolve → gate → extract → filter/report), non-destructive `closest()` gate, carrier-chain nested merge, detached-clone text extraction with element-boundary whitespace. response gains `stats` (additive, non-breaking). `src/tools/registry.js` tool description documents the contract.

## tests
`tests/playwright/integration/scrape.spec.js` — SCRAPE-1..15, offline `data:` URL fixtures. red baseline 10/12 failing, all green after fix. covers: leaf/container selectors, DOM immutability, h4-h6, mixed/nested roots + order, boilerplate gating (incl. explicitly selected), hidden text + no script leakage, stats accounting invariant, nested merge (incl. deep chain table>blockquote>p), atomic tables, auto-mode main/body, structured selector errors.
