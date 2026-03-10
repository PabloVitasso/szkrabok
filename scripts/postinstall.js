#!/usr/bin/env node
// Smart Chromium installer — runs after npm install.
// Skips if: CI env, SZKRABOK_SKIP_BROWSER_INSTALL set, or Chromium already found.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

if (process.env.CI || process.env.SZKRABOK_SKIP_BROWSER_INSTALL) {
  console.log('szkrabok: skipping browser install (CI or SZKRABOK_SKIP_BROWSER_INSTALL set).');
  process.exit(0);
}

const findChromium = () => {
  const playwrightCache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(playwrightCache)) {
    const dirs = readdirSync(playwrightCache)
      .filter(d => d.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      for (const bin of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = join(playwrightCache, dir, bin);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(p)) return p;
  }
  return null;
};

if (findChromium()) {
  console.log('szkrabok: Chromium already available, skipping install.');
  process.exit(0);
}

console.log('szkrabok: installing Playwright Chromium browser...');
try {
  execSync('npx playwright install chromium', { stdio: 'inherit' });
} catch {
  console.error(
    'szkrabok: browser install failed. Run "szkrabok --setup" manually to retry.'
  );
}
