# Feature: ship the stealth-patched playwright-core as a package (drop postinstall)

## Status

Proposal. Not started. Interim mitigation done: `packages/runtime/patch-check.js`
(one marker list), `szkrabok doctor` reads `coreBundle.js` markers,
`launch()`/`launchClone()` warn once per process when Chromium runs unpatched.

## Problem

`postinstall` = `scripts/apply-patches.js` (patch-package, one diff per pinned
version) → `scripts/verify-playwright-patches.js` (fails the install on a
missing marker). It rewrites `playwright-core/lib/coreBundle.js` in the
consumer's tree. Stealth depends on it (rebrowser 9/10; without it
`Runtime.enable` and friends leak).

| # | Finding | Effect |
|---|---|---|
| 1 | needs install scripts | skipped by `npm --ignore-scripts` (common hardening), pnpm 10 (dependency builds blocked until approved), Bun (only `trustedDependencies`) → stock core, stealth silently gone. Interim: doctor + launch warning (detect, not fix) |
| 2 | edits another package's files | patches whichever `playwright-core` resolves in the consumer's tree, also the one `@playwright/test` uses → side effects in the consumer's own tests (`setContent` hangs, no console events: R2 in the hardening doc) |
| 3 | integrity | lockfile `integrity` covers the downloaded tarball, not the files rewritten afterwards; provenance/signature checks say nothing about the code that runs |
| 4 | install-time code from a dependency | exactly what the hardening work treats as hostile elsewhere (`scaffold_init --ignore-scripts`); spec roots must run installs with scripts on (handout task 2) |
| 5 | hoisting-sensitive | `apply-patches.js` needs module-resolution heuristics (npm root bound, nested fallback, temp `package.json` for npx) to find the right copy |

## Common practice

From general knowledge; check current upstream docs before relying on details.

- rebrowser-patches: besides its patch CLI, publishes drop-in packages
  (`rebrowser-playwright`, `rebrowser-playwright-core`), used via npm alias.
- Patchright: patched Playwright fork published as its own package
  (`patchright`, `patchright-core`).
- patch-package: meant for an app patching its own dependencies, not for a
  library patching its consumers'. pnpm `patchedDependencies` and Yarn
  `patch:` are root-project features too.

## Design

1. **Publish** `@szkrabok/playwright-core` (name open, Q1): upstream
   `playwright-core@X` tarball + `patches/playwright-core+X.patch`, built in
   CI. Marker check (`patch-check.js`) on the packed tarball before
   publish. `npm publish --provenance`, 2FA.
2. **Version** `X-szk.N` (e.g. `1.63.0-szk.1`), pinned exactly. `N` bumps on
   a patch-only change. Prerelease tags are invisible to ranges, which is
   fine: nothing should pick it up by range.
3. **Depend on core directly.** `launch.js` imports `chromium`, `firefox`
   from `playwright-core`, not `playwright`. Reason: `playwright@1.63.0`
   depends on `playwright-core: 1.63.0` exactly; an alias at `1.63.0-szk.1`
   does not satisfy it, so npm nests a **stock** core under `playwright/`
   and `import 'playwright'` would load that. `overrides` cannot fix it from
   inside a library (root project only).
4. **Alias in szkrabok's `package.json`:**
   `"playwright-core": "npm:@szkrabok/playwright-core@1.63.0-szk.1"`. Drop
   `playwright` if nothing else needs it (`doctor install` spawns `npx
   playwright install chromium`: switch to the core CLI or keep `playwright`
   only for that, Q3).
5. **Spec roots / consumers running specs over CDP** (`@playwright/test` →
   its own core): the spec process's Playwright speaks CDP to the browser,
   so it needs the patched core too. Root-project `overrides`:
   `{ "playwright-core": "npm:@szkrabok/playwright-core@1.63.0-szk.1" }`.
   Document in README, scaffold template, companion handout task 2.
6. **Remove** `postinstall`, `scripts/apply-patches.js`, `patch-package`
   dependency, `scripts/resolve-playwright-core.js` if unused. Keep
   `patches/` (CI input), `patch-check.js`, doctor and launch warnings
   (still catch a stock core, e.g. a consumer dedupe).
7. **Licence:** Playwright is Apache-2.0. Ship `LICENSE`, `NOTICE`, and the
   patch (modified files must state the change, §4b).

## Rejected alternatives

| Alternative | Why not |
|---|---|
| keep postinstall, harden it | findings 1–4 stay; detection only |
| load-time patch (`module.register` loader hook rewrites `coreBundle.js`) | no install step, but fragile string surgery on every start of a 3 MB bundle; does not reach `@playwright/test` in spec processes |
| vendor patched core inside the szkrabok tarball | no publish, but +~14 MB unpacked per release and still nothing for spec processes |
| pnpm/Yarn patch protocols | root-project only; consumers would each maintain the patch |

## Migration

- Minor release (no API change). Release note: consumers running specs over
  CDP add the `overrides` entry; others do nothing.
- One release with both: alias + postinstall that no-ops when markers are
  already present. Then drop the postinstall.
- Playwright upgrade flow (`docs/development.md`): regenerate the patch as
  today, then CI publishes `X-szk.1`, then bump the alias.

## Tests

- CI: packed tarball has every marker (`missingPatchMarkers` → `[]`).
- Smoke test (`scripts/smoke-test.js`): install the szkrabok tarball **with
  `--ignore-scripts`**; `szkrabok doctor` reports patched. Today that
  install would be unpatched: the test proves finding 1 is gone.
- `tests/node/playwright-patches.test.js` unchanged (markers, launch warning).
- e2e rebrowser stays 9/10.

## Open questions

1. Package name and scope: `@szkrabok/playwright-core` (scope ownership not
   verified; the sandbox could not query the registry) or unscoped.
2. Who owns publishing credentials and the CI job (GitHub Actions here are
   `.disabled` today).
3. Keep the `playwright` dependency only for `npx playwright install
   chromium`, or call the core's installer.
4. Firefox path: unpatched by design; confirm nothing in the Firefox launch
   needs `playwright` specifically.
