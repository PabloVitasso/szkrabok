#!/usr/bin/env node
import 'dotenv/config';
import { createServer } from './server.js';
import { log, logError } from './utils/logger.js';

// Parse CLI args
const args = process.argv.slice(2);

if (args.includes('init')) {
  const { init } = await import('./tools/scaffold.js');
  const result = await init({ dir: process.cwd(), preset: 'minimal', install: false });
  if (result.created.length) console.error(`Created: ${result.created.join(', ')}`);
  if (result.merged.length) console.error(`Merged: ${result.merged.join(', ')}`);
  if (result.skipped.length) console.error(`Skipped (already exists): ${result.skipped.join(', ')}`);
  if (result.warnings.length) result.warnings.forEach(w => console.error(`Warning: ${w}`));
  console.error('Done. Run "szkrabok --setup" if Chromium is not yet installed.');
  process.exit(0);
}

if (args.includes('--setup')) {
  const { execSync } = await import('node:child_process');
  console.log('Installing Playwright Chromium browser...');
  try {
    execSync('npx playwright install chromium', { stdio: 'inherit' });
    console.log('Browser installed successfully.');
  } catch {
    console.error('Browser install failed. Run manually: npx playwright install chromium');
    process.exit(1);
  }
  process.exit(0);
}

if (args.includes('--no-headless') || args.includes('--headful')) {
  process.env.HEADLESS = 'false';
}

const server = createServer();

process.on('SIGINT', async () => {
  log('Shutting down gracefully...');
  await server.close();
  process.exit(0);
});

process.on('uncaughtException', err => {
  logError('Uncaught exception', err);
  process.exit(1);
});

server.connect().catch(err => {
  logError('Failed to start server', err);
  process.exit(1);
});
