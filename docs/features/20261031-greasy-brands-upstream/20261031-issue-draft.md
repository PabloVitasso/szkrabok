# Issue draft: rebrowser/rebrowser-patches — brands for a custom user agent

Not posted. Fill the two `TODO(host)` blocks from a host run first (plan step 4).

Attached patch: [0001-Playwright-send-Chrome-s-brand-list-for-a-custom-Chr.patch](./0001-Playwright-send-Chrome-s-brand-list-for-a-custom-Chr.patch)

- Base: rebrowser-patches main `00c62cd` (2026-10-19), 1.64.1 only
- Contents: `src.patch` + `lib.patch` regenerated with `release/port.mjs playwright-core 1.64.1 --regen --write` (type-check on, original build == npm tarball, tarball + lib.patch verified), new suite `tests/suites/uabrands.mjs` + `tests/workers/uabrands.mjs`, README section
- Author line is the sandbox placeholder (`Claude <myemail@example.com>`): `git am` it, then `git commit --amend --reset-author`
- Not run: their test suite (it downloads Chrome; host only)

---

**Title:** Playwright: custom `userAgent` keeps the binary's `userAgentData.brands`

With `browser.newContext({ userAgent })`, Playwright's `calculateUserAgentMetadata()` (crPage.ts) sends `Emulation.setUserAgentOverride` with platform hints but no `brands`. Chromium then keeps the binary's own lists (`EmulationHandler::SetUserAgentOverride`, emulation_handler.cc: unset `brands` / `fullVersionList` → defaults). So `navigator.userAgentData.brands` and `Sec-CH-UA` name the launched binary at its real version, e.g. only `Chromium` for the bundled build, while `navigator.userAgent` claims another Chrome version. Easy for a page to compare.

TODO(host): stock vs patched output for UA `Chrome/131.0.0.0` on a ≠131 binary — page brands, worker brands, `Sec-CH-UA`.

The attached patch sets `brands` in `calculateUserAgentMetadata()` for `Chrome/<major>` user agents, so it also covers service workers (`crServiceWorker.ts` calls the same function). The list is built the way Chrome builds it: `GenerateBrandVersionList` + `GetGreasedUserAgentBrandVersion` + `GetRandomOrder` in `components/embedder_support/user_agent_utils.cc`, all seeded by the major version. Checked against real Chrome `Sec-CH-UA` for 120, 124, 126, 129, 131 and 138. <!-- TODO(host): replace recalled values with a live capture before posting --> Opt-out: `REBROWSER_PATCHES_UA_BRANDS_FIX=0`. Edge / Opera user agents are left alone.

TODO(host): `uabrands` suite result.

Open point: `fullVersionList` stays at the binary default. Setting it needs a full version, and a reduced UA only carries `N.0.0.0`. Happy to change this if you prefer another approach.
