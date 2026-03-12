#!/usr/bin/env node
// Smart Chromium installer — runs after npm install.
// Skips if: CI env, SZKRABOK_SKIP_BROWSER_INSTALL set, or Chromium already found.

import { execSync } from 'node:child_process';
import { findChromium } from './find-chromium.js';

if (process.env.CI || process.env.SZKRABOK_SKIP_BROWSER_INSTALL) {
  console.log('szkrabok: skipping browser install (CI or SZKRABOK_SKIP_BROWSER_INSTALL set).');
  process.exit(0);
}

if (await findChromium()) {
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
