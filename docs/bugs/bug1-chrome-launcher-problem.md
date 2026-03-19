# Bug: chrome-launcher detects snap stubs as valid Chromium installations

**Status:** open — deferred
**Affects:** `packages/runtime/config.js:findChromiumPath`, `tests/node/runtime/pc-layer6.test.js` (fixed in tests)

---

## Symptom

On Ubuntu with the `chromium-browser` snap package installed, `chrome-launcher`'s
`Launcher.getInstallations()` returns `/usr/bin/chromium-browser`. That path exists on
disk but is a shell stub that prints:

```
Command '/usr/bin/chromium-browser' requires the chromium snap to be installed.
Please install it with: snap install chromium
```

…then exits with code 1. No browser process starts. No `DevToolsActivePort` is written.

## Impact

### `findChromiumPath` (`packages/runtime/config.js`)

`chrome-launcher` is tried first. It returns the stub path. `findChromiumPath` returns it
immediately and never reaches the Playwright fallback. Any subsequent `launchPersistentContext`
call spawns the stub, which exits instantly, and the port-wait loop times out.

This means **szkrabok fails to launch a browser on Ubuntu snap Chromium machines** even
though Playwright's bundled Chromium is present and functional.

### PC-6 tests (`tests/node/runtime/pc-layer6.test.js`)

Same false-positive caused the Chromium describe block to run against the stub. All 5
integration tests timed out waiting for `DevToolsActivePort`. The tests were fixed by
removing `chrome-launcher` from the test entirely and using `chromium.executablePath()`
from Playwright directly (same binary as e2e tests).

## Root cause

`chrome-launcher` performs a filesystem existence check (`existsSync`) but does not
validate that the binary is executable or that it is a real Chromium binary rather than
a wrapper/stub.

## Fix (deferred)

In `findChromiumPath`, swap the resolver order: try Playwright's bundled Chromium first,
fall back to `chrome-launcher` only if Playwright's path is absent. Optionally add a
smoke-test (e.g. `--version` flag) before accepting a path from `chrome-launcher`.

```js
// Proposed order in findChromiumPath:
async () => {
  const { chromium } = await import('playwright');
  const pwPath = chromium.executablePath();
  return pwPath && existsSync(pwPath) ? pwPath : null;
},
async () => {
  const { Launcher } = await import('chrome-launcher');
  const installs = await Launcher.getInstallations();
  return installs[0] ?? null;
},
```

## Notes

- The snap stub issue is Ubuntu/Debian-specific but the ordering fix is safe on all platforms.
- Playwright's bundled Chromium is always the right default for headless automation;
  system browsers are an optimisation for environments that already have one installed.
- Related: `chrome-launcher` is also used as the browser detector in PC-6 tests — that
  usage was removed as part of discovering this bug.
