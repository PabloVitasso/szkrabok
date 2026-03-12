import { existsSync } from 'node:fs';

/**
 * Cross-platform Chromium finder. Checks in order:
 *   1. Playwright-managed Chromium (playwright direct dep, cross-platform)
 *   2. System Chrome via chrome-launcher (workspace dep, hoisted, cross-platform)
 *
 * Returns the executable path string, or null if nothing found.
 */
export const findChromium = async () => {
  try {
    const { chromium } = await import('playwright');
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch { /* playwright not available */ }

  try {
    const { Launcher } = await import('chrome-launcher');
    const installs = await Launcher.getInstallations();
    if (installs.length > 0) return installs[0];
  } catch { /* chrome-launcher not available */ }

  return null;
};
