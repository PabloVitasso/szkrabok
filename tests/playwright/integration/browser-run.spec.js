/**
 * browser_run (inline code) — fn/args behavior
 * Regression test for docs/bugs/2026-09-30-browser-run-fn-args-schema-mismatch.md
 */

import { test, expect } from './fixtures.js';
import { randomUUID } from 'crypto';

test.describe('browser_run inline code', () => {
  test('bare function code still works as default (backward compat)', async ({
    client,
    openSession,
  }) => {
    const sessionId = `run-${randomUUID()}`;
    await openSession(client, sessionId, { url: 'https://example.com' });

    const result = await client.callTool({
      name: 'browser_run',
      arguments: { sessionName: sessionId, code: '(page) => page.title()' },
    });

    const { result: title } = JSON.parse(result.content[0].text);
    expect(title).toContain('Example');

    await client.callTool({
      name: 'session_manage',
      arguments: { action: 'close', sessionName: sessionId },
    });
  });

  test('named export selected via fn and args forwarded as 2nd param', async ({
    client,
    openSession,
  }) => {
    const sessionId = `run-${randomUUID()}`;
    await openSession(client, sessionId, { url: 'https://example.com' });

    const result = await client.callTool({
      name: 'browser_run',
      arguments: {
        sessionName: sessionId,
        code: `({
          default: async (page) => 'unused',
          greet: async (page, args) => \`hello \${args.name}\`,
        })`,
        fn: 'greet',
        args: { name: 'szkrabok' },
      },
    });

    const { result: greeting } = JSON.parse(result.content[0].text);
    expect(greeting).toBe('hello szkrabok');

    await client.callTool({
      name: 'session_manage',
      arguments: { action: 'close', sessionName: sessionId },
    });
  });

  test('unknown fn on inline code object reports available exports', async ({
    client,
    openSession,
  }) => {
    const sessionId = `run-${randomUUID()}`;
    await openSession(client, sessionId, { url: 'https://example.com' });

    const result = await client.callTool({
      name: 'browser_run',
      arguments: {
        sessionName: sessionId,
        code: `({ default: async (page) => 'ok' })`,
        fn: 'missing',
      },
    });

    expect(result.isError).toBeTruthy();
    const text = result.content[0].text;
    expect(text).toContain('missing');
    expect(text).toContain('default');

    await client.callTool({
      name: 'session_manage',
      arguments: { action: 'close', sessionName: sessionId },
    });
  });
});
