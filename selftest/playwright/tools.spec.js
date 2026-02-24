/**
 * Szkrabok CSS Selector Tools Tests
 * Tests interact, navigate, extract, and workflow tools
 */

import { test, expect } from './fixtures.js';
import { randomUUID } from 'crypto';

test.describe('CSS Selector Tools', () => {
  test('navigate.goto navigates to URL', async ({ client, openSession }) => {
    const sessionId = `nav-${randomUUID()}`;

    await openSession(client, sessionId, { url: 'https://example.com' });

    const response = await client.callTool({
      name: 'nav.goto',
      arguments: {
        id: sessionId,
        url: 'https://www.iana.org/domains/reserved',
      },
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('success');

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { id: sessionId },
    });
  });

  test('extract.text extracts page text', async ({ client, openSession }) => {
    const sessionId = `extract-${randomUUID()}`;

    await openSession(client, sessionId, { url: 'https://example.com' });

    const response = await client.callTool({
      name: 'extract.text',
      arguments: {
        id: sessionId,
        selector: 'h1',
      },
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('Example Domain');

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { id: sessionId },
    });
  });

  test('extract.html extracts page HTML', async ({ client, openSession }) => {
    const sessionId = `html-${randomUUID()}`;

    await openSession(client, sessionId, { url: 'https://example.com' });

    const response = await client.callTool({
      name: 'extract.html',
      arguments: { id: sessionId },
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('<!DOCTYPE html>');
    expect(content.text).toContain('Example Domain');

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { id: sessionId },
    });
  });
});

test.describe('Workflow Tools', () => {
  test('workflow.scrape extracts structured data', async ({ client, openSession }) => {
    const sessionId = `scrape-${randomUUID()}`;

    await openSession(client, sessionId, { url: 'https://example.com' });

    const response = await client.callTool({
      name: 'workflow.scrape',
      arguments: {
        id: sessionId,
        selectors: {
          title: 'h1',
          paragraph: 'p',
        },
      },
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('Example Domain');

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { id: sessionId },
    });
  });
});
