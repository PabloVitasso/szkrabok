// @ts-check
import { defineConfig } from 'playwright/test';
import { env } from './config/env.js';
import { paths } from './config/paths.js';
import { loadToml } from './config/toml.js';
import { resolvePreset } from './config/preset.js';
import { resolveSession } from './config/session.js';
import { resolveExecutable } from './config/browser.js';
import { integration, e2e } from './config/projects.js';

const toml = loadToml(paths.config);
const preset = resolvePreset(toml, env);
const session = resolveSession(env, paths);
const executable = resolveExecutable();

/** @type {import('playwright/test').PlaywrightTestConfig} */
export default defineConfig({
  fullyParallel: true,
  forbidOnly: env.ci,
  timeout: 60000,
  outputDir: session.results,

  reporter: [['list'], ['json', { outputFile: session.lastRun }]],

  projects: [integration(paths), e2e({ paths, preset, session, executable, env })],

  globalSetup: env.project === 'e2e' ? paths.automation.setup : undefined,
  globalTeardown: env.project === 'e2e' ? paths.automation.teardown : undefined,
});
