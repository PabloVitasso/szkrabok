/**
 * Szkrabok Test Configuration
 * Uses Playwright test runner with custom MCP fixtures
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/szkrabok',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  timeout: 60000, // 60s per test
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'szkrabok',
      testMatch: '**/*.spec.ts',
    },
  ],
});
