/**
 * Smoke test: browser_run_test uses CDP path — no runtime import in MCP mode.
 *
 * Simulates the real user journey:
 *   1. User adds szkrabok via: claude mcp add szkrabok -- npx -y @pablovitasso/szkrabok
 *   2. User opens a session
 *   3. User calls browser_run_test — spec connects via CDP, runtime never imported
 *
 * Uses the sk-skills companion project as the target. sk-skills/automation/fixtures.js
 * implements Phase B: connectOverCDP for MCP path, dynamic import for standalone.
 * This proves the CDP path works end-to-end in a real user project.
 *
 * sk-skills path: /home/jones2/mega/research/sk-skills
 */
import { test, expect } from './fixtures.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const SK_SKILLS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'sk-skills');

// SKIPPED: depends on sk-skills companion project (@pablovitasso/szkrabok must be up-to-date).
// Enable manually when verifying CDP end-to-end after a release and sk-skills npm update.
// What this tests: browser_run_test CDP path in a real external project
// (sk-skills/automation/example.spec.js via connectOverCDP, no runtime import in MCP mode).
test.skip('browser_run_test uses CDP path in sk-skills project', async ({ client, openSession }) => {
  const sessionName = `smoke-${randomUUID().slice(0, 8)}`;

  try {
    await openSession(client, sessionName);

    // Run example.spec.js from sk-skills via CDP.
    // fixtures.js uses connectOverCDP (Phase B) — no runtime import in MCP path.
    const run = await client.callTool({
      name: 'browser_run_test',
      arguments: {
        sessionName,
        config:  `${SK_SKILLS}/playwright.config.js`,
        project: 'example',
        files:   [`${SK_SKILLS}/automation/example.spec.js`],
        workers: 1,
      },
    });
    const result = JSON.parse(run.content[0].text);

    expect(result.failed, `CDP path failed:\n${result.log?.slice(-10).join('\n')}`).toBe(0);
    expect(result.passed).toBeGreaterThan(0);
  } finally {
    await client.callTool({
      name: 'session_manage',
      arguments: { action: 'close', sessionName },
    }).catch(() => {});
  }
});
