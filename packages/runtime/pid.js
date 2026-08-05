// ── tryBrowserPid ─────────────────────────────────────────────────────────────
//
// Attempts to extract the real Chromium OS process PID from the Playwright
// Browser object. This is inherently best-effort — the public API
// (browser.process()) only exists when the browser was launched via
// launchServer(); the private API (osProcess()._process.pid) may not exist
// in all Playwright versions or browser forks.
//
// Verified against playwright 1.62.1 (see package.json). If this breaks after
// a Playwright upgrade, the fix belongs in this one function/module.
//
// Guards against the Node.js global `process` shadowing a non-existent
// browser.process method in ES module scope (process is a free variable).
//
// Returns a pid number or null.

export const tryBrowserPid = browser => {
  try {
    if ('process' in browser && typeof browser.process === 'function') {
      try {
        return browser.process()?.pid ?? null;
      } catch {
        return null;
      }
    }
  } catch { /* not a browser.process() instance */ }
  try {
    return browser.osProcess()?._process?.pid ?? null;
  } catch {
    return null;
  }
};
