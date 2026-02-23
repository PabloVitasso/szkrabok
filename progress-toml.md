# TOML config implementation progress

## Goal

Single `szkrabok.config.toml` at repo root — browser presets (UA, viewport, locale, timezone,
label) shared by both MCP session launch and Playwright standalone test runs. No duplicate
configuration, no duplicate browser installs.

## Status

### Done

- [x] `smol-toml` installed (dependencies)
- [x] `szkrabok.config.toml` created with default + 7 presets, labels, full comments
- [x] `src/config.js` updated — loads TOML, exports `resolvePreset()`, `PRESETS`, `STEALTH_ENABLED`
- [x] `src/tools/szkrabok_session.js` — uses `resolvePreset`, returns full config + label in response
- [x] `src/core/pool.js` — stores preset + label per session
- [x] `src/tools/registry.js` — `preset` and `userAgent` added to `session.open` schema
- [x] `automation/setup.js` created — globalSetup prints resolved preset to console

### In progress

- [ ] Fix `@playwright/test` import specifier everywhere (see issue below)
- [ ] Fix `playwright.config.ts` — read TOML directly (do not import src/config.js)

### Todo

- [ ] Run full test suite (selftest + automation) green
- [ ] Verify `session.open` response includes preset + label + config
- [ ] Verify Playwright standalone run prints preset line to console
- [ ] Commit + push

---

## Key issue: `@playwright/test` does not exist as a package

**Root cause:** `@playwright/test` was never in `package.json` or `node_modules/@playwright/`.
The `playwright` package exports everything via `playwright/test` specifier.
Playwright's CLI used to intercept this internally but that stopped working after `npm install`.

**Fix:** Replace all `from '@playwright/test'` with `from 'playwright/test'` in our files.
The `packages/` subdirectory contains upstream files — leave those alone.

**Files to fix (ours only):**

- `playwright.config.ts`
- `selftest/playwright/fixtures.js`
- `automation/fixtures.js`

**`packages/` files:** upstream — do not touch.

---

## Key issue: `playwright.config.ts` must not import `src/config.js`

Playwright loads `playwright.config.ts` through its own ESM transform pipeline.
Importing `src/config.js` from there couples the MCP module graph into Playwright's loader
and can cause resolution ordering issues.

**Fix:** `playwright.config.ts` reads the TOML file directly using `smol-toml` + `readFileSync`.
Same 3-line pattern as `src/config.js`. Same TOML file. No cross-module import.
`src/config.js` and `playwright.config.ts` are independent readers of the same file.

---

## Architecture: one package, two readers

```
szkrabok.config.toml
       |
       +---> src/config.js         (MCP server startup — resolvePreset, exports)
       |
       +---> playwright.config.ts  (Playwright test runs — use.userAgent, use.viewport)
```

Both use `smol-toml`. Same dep, same file, zero duplication. No circular imports.
