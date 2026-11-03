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

Measured on the host (2026-11-02): playwright-core 1.63.0 stock vs greasy-patched, ungoogled-chromium 155.0.8059.79, context UA `Chrome/120.0.0.0`, local server. Stock + context UA: page brands `Chromium/155 Not(A:Brand/24`, wire `Sec-CH-UA` `"Chromium";v="155", "Not(A:Brand";v="24"` — binary brands, UA string 120. Patched + context UA: page brands `Not_A Brand/8 Chromium/120 Google Chrome/120`, wire `Sec-CH-UA` 120 — brands fixed. In both cases the wire `Sec-CH-UA-Full-Version-List` stayed `"Chromium";v="155.0.8059.79", "Not(A:Brand";v="24.0.0.0"`. So the mismatch is externally visible in the same request even after the brands fix. Dedicated worker followed the page; service worker brands became greasy but FVL empty; shared worker stayed native. Full table: [../20261031-verified-core-and-vendored-evasions-plan.md](../20261031-verified-core-and-vendored-evasions-plan.md) "Stock vs patched, measured".

The attached patch sets `brands` in `calculateUserAgentMetadata()` for `Chrome/<major>` user agents, so it also covers service workers (`crServiceWorker.ts` calls the same function). The list is built the way Chrome builds it: `GenerateBrandVersionList` + `GetGreasedUserAgentBrandVersion` + `GetRandomOrder` in `components/embedder_support/user_agent_utils.cc`, all seeded by the major version. Checked against real Chrome `Sec-CH-UA` for 120, 124, 126, 129, 131 and 138. <!-- Values for those six milestones are published/recalled; the live capture covers 145 only (CAPTURED_145, Chromium-branded 2-brand build) — a real Chrome channel capture would settle the 3-brand ordering. --> Opt-out: `REBROWSER_PATCHES_UA_BRANDS_FIX=0`. Edge / Opera user agents are left alone.

TODO(host): `uabrands` suite result.

Open point: `fullVersionList`. Leaving it unset does not reliably keep the binary default: measured on Chrome for Testing 145.0.7632.46 and ungoogled-chromium 155.0.8059.79 — without a browser-level UA override, the page, dedicated-worker and shared-worker contexts report the binary's exact build (brands 120 vs `fullVersionList` 155.0.8059.79 on ungoogled 155; 145.0.7632.46 on CfT 145); service workers return empty. The leak is also in the wire header `Sec-CH-UA-Full-Version-List`: with brands fixed to 120 the header still said 155.0.8059.79 in the same request. Extending `calculateUserAgentMetadata` to set `fullVersionList`/`fullVersion`/`bitness` fixed the page, dedicated worker and service worker in a local build. The shared worker needs its own target hook: sending `Emulation.setUserAgentOverride` on the `shared_worker` target fixes brands/FVL and the wire `User-Agent` header but not `navigator.userAgent`, and the override reverts when the session detaches — `service_worker` targets behave the same way. Value choice: a reduced UA only carries `N.0.0.0`, but real Chrome's FVL carries the real build (captured: Chromium `145.0.7632.46`, GREASE `99.0.0.0`), so `N.0.0.0` is itself a fingerprint. Setting it needs a full version; happy to take a different approach (optional full-version argument, or document the reduced-UA tradeoff).
