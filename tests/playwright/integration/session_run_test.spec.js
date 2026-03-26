/**
 * Integration tests for session_run_test — EX-2 test plan.
 * Real MCP server, real headless browser, real playwright spec subprocess.
 *
 * Covers the two gaps left by unit tests:
 *   EX-2.1  template mode end-to-end (basic sanity)
 *   EX-2.2  postPolicy keep — session stays open after test
 *   EX-2.3  withLock — two concurrent same-name calls both complete (no deadlock / race)
 */

import { test, expect } from './fixtures.js';
import { randomUUID } from 'crypto';

// Spec file run by browser_run_test inside each session_run_test call.
// Uses the e2e fixture so _runtimeHandle teardown writes the attach-signal file.
const NOOP_SPEC = 'tests/playwright/e2e/noop.spec.js';

const srt = (name, extra = {}) => ({
  name: 'session_run_test',
  arguments: {
    session: {
      name,
      mode: 'template',
      launchOptions: { headless: true },
      ...extra.session,
    },
    test: {
      spec: NOOP_SPEC,
      project: 'e2e',
      ...extra.test,
    },
    ...extra.top,
  },
});

test.describe('session_run_test', () => {

  test('EX-2.1 template mode end-to-end: response shape correct, session saved and inactive', async ({ client }) => {
    const name = `srt-e2e-${randomUUID()}`;

    const response = await client.callTool(srt(name));
    const result = JSON.parse(response.content[0].text);

    expect(result.error).toBeUndefined();
    expect(result.session.logicalName).toBe(name);
    expect(result.session.runtimeName).toBe(name);  // template: runtimeName === logicalName
    expect(result.session.mode).toBe('template');
    expect(result.test).toBeDefined();

    // postPolicy defaults to 'save' for template → browser closed, profile kept on disk.
    // session_manage list returns ALL stored sessions (active and inactive).
    const list = await client.callTool({ name: 'session_manage', arguments: { action: 'list' } });
    const { sessions } = JSON.parse(list.content[0].text);
    const entry = sessions.find(s => s.id === name);
    expect(entry, 'saved session should appear in list').toBeDefined();
    expect(entry.active, 'session should be inactive after postPolicy:save').toBe(false);

    // Cleanup stored profile.
    await client.callTool({ name: 'session_manage', arguments: { action: 'delete', sessionName: name } });
  });

  test('EX-2.2 postPolicy keep: session stays open after test', async ({ client }) => {
    const name = `srt-keep-${randomUUID()}`;

    const response = await client.callTool(srt(name, { top: { postPolicy: { action: 'keep' } } }));
    const result = JSON.parse(response.content[0].text);

    expect(result.error).toBeUndefined();

    // Session must still be open.
    const list = await client.callTool({ name: 'session_manage', arguments: { action: 'list' } });
    expect(list.content[0].text).toContain(name);

    // Cleanup.
    await client.callTool({ name: 'session_manage', arguments: { action: 'close', sessionName: name } });
    await client.callTool({ name: 'session_manage', arguments: { action: 'delete', sessionName: name } });
  });

  test('EX-2.3 withLock: two concurrent same-name calls both complete without error', async ({ client }) => {
    const name = `srt-concurrent-${randomUUID()}`;

    // Both calls use the same session name. withLock serializes them so the second
    // waits for the first to fully complete (test + postPolicy) before starting.
    // If withLock were deadlocked, both would hang until the test timeout fires.
    const [r1, r2] = await Promise.all([
      client.callTool(srt(name)),
      client.callTool(srt(name)),
    ]);

    const results = [r1, r2].map(r => JSON.parse(r.content[0].text));

    for (const result of results) {
      expect(result.error).toBeUndefined();
      expect(result.session.logicalName).toBe(name);
    }

    // Cleanup stored profile (created by the two template-mode runs).
    await client.callTool({ name: 'session_manage', arguments: { action: 'delete', sessionName: name } });
  });
});
