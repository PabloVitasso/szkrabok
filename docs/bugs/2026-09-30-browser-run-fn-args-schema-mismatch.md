# Bug: browser_run — fn/args params dead, schema doesn't match implementation

**Date:** 2026-09-30
**Reporter:** Pablo Vitasso
**szkrabok version:** 2.1.3 (npx-installed, cache hash 535c3d581cda60c6)
**Environment:** Linux jones2-VirtualBox 6.11.0-19-generic (Ubuntu 24.04), Node v24.13.1

---

## Summary
telegraphic. schema for browser_run promises features implementation doesn't have. wasted ~10 tool calls guessing correct code shape before reading source.

## severity
low-medium. not a crash, not data loss. pure DX/discoverability bug. wrong docs -> agent (or human) burns time reverse-engineering calling convention by trial+error.

## environment
- tool: mcp__szkrabok__browser_run
- install: npx -y @pablovitasso/szkrabok, cache path /home/jones2/.npm/_npx/535c3d581cda60c6/
- source: src/tools/szkrabok_browser.js, run_code export, lines ~262-273

## schema says (as surfaced to caller)
- code: inline snippet
- path: .mjs file, named export, called with (page, args)
- fn: "Named export to call. Defaults to 'default'"
- args: "Arguments passed as second parameter to the function"
- implication: code should export an object of named fns, e.g. { default: (page,args)=>... }, fn param selects which one, args param forwarded as 2nd param.

## implementation actually does (run_code, verbatim)
```js
export const run_code = async args => {
  const { sessionName, code } = args;
  const session = getSession(sessionName);
  const fn = eval(`(${code})`);
  const result = await fn(session.page);
  return { result, url: session.page.url() };
};
```
- only sessionName + code destructured. fn param (tool input) never read. args param (tool input, the "2nd arg" one) never read.
- code wrapped in eval(`(${code})`) — code must evaluate directly to a callable, not an exports object.
- resulting fn called with single arg: session.page. no args forwarding, no fn-name lookup.
- path param: not seen in this branch at all — presumably dead too for this action, not verified (out of scope, did not repro).

## repro steps
1. open any session (session_manage action:open)
2. call browser_run with sessionName + code: `{ default: async (page, args) => ({ title: await page.title() }) }`
3. observe error

## actual result (chain of misleading errors while guessing shape)
- `return {...}` -> `SyntaxError: Unexpected token 'return'` (eval wraps in parens, return illegal there)
- `await page.title()` -> `SyntaxError: Unexpected identifier 'page'` (top-level await not in async scope, treated as plain identifier)
- `page.title()` -> `ReferenceError: page is not defined` (page only exists as fn's own param name, not ambient)
- `Object.keys(globalThis)...` -> `TypeError: fn is not a function` (evaluated to non-function, "fn" here is literally run_code's internal local var name, coincidentally same as the dead input param name -- doubly misleading)
- `({ default: async (page,args)=>({...}) })` + explicit fn:"default" input param -> still `TypeError: fn is not a function` (input param fn genuinely ignored, confirms schema mismatch)
- `export default ...` -> `SyntaxError: Unexpected token 'export'` (not ESM eval, plain expression eval)

every error message is accurate to what actually ran, but none of them hint that the whole named-export/fn-selector model doesn't exist for the code path taken.

## expected result
either:
- schema/description updated to say: code must be a single function `(page) => ...`, fn/args/path params not applicable to inline code mode. OR
- implementation updated to honor fn+args per schema: build exports obj from code, default to 'default' key, call `exportsObj[fn](page, args)`.

## working call (confirmed)
```js
(page) => page.title()
```
returns `{"result": "<title>", "url": "<url>"}`. sync or async arrow, single page param, bare expression (auto-wrapped in parens by eval).

## root cause hypothesis
schema written for a more complete planned implementation (named exports from .mjs path files, fn selector, args forwarding) that got implemented for the `path` variant but not backported to the `code` (inline) variant, OR code variant is a simplified fast-path that never got its docstring/schema updated to match.

## suggested fix
1. minimal: fix tool description string for `code` to say "must evaluate to a function taking (page)" — drop fn/args mention when using inline code, or clarify they're path-only.
2. better: make code path consistent with path path — wrap code same way path.mjs modules are loaded (named exports, fn selector, args as 2nd param) so both variants behave identically per current schema promise.
3. either way: `fn is not a function` error message collides with an internal var also named `fn` — rename internal var to avoid a misleading coincidence in error text (e.g. `handler` or `target`) regardless of which fix direction is chosen.
