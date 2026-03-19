import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './automation',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json']],
  use: { headless: false },
});
