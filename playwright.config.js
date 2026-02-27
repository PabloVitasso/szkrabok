// @ts-check
import { defineConfig } from 'playwright/test';
import { env } from './config/env.js';
import { paths } from './config/paths.js';
import { loadToml } from './config/toml.js';
import { resolvePreset } from './config/preset.js';
import { resolveSession } from './config/session.js';
import { resolveExecutable } from './config/browser.js';
import { selftest, mcp, automation } from './config/projects.js';

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

  projects: [selftest(paths), mcp(paths), automation({ paths, preset, session, executable, env })],

  globalSetup: env.project === 'automation' ? paths.automation.setup : undefined,
  globalTeardown: env.project === 'automation' ? paths.automation.teardown : undefined,
});
