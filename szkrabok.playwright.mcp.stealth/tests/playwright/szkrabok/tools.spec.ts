/**
 * Szkrabok CSS Selector Tools Tests
 * Tests interact, navigate, extract, and workflow tools
 */

import { test, expect } from './fixtures';
import { randomUUID } from 'crypto';

test.describe('CSS Selector Tools', () => {
  test('navigate.goto navigates to URL', async ({ client }) => {
    const sessionId = `nav-${randomUUID()}`;

    // Open session
    await client.callTool({
      name: 'session.open',
      arguments: {
        id: sessionId,
        url: 'https://example.com',
      },
    });

    // Navigate to different URL
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

  test('extract.text extracts page text', async ({ client }) => {
    const sessionId = `extract-${randomUUID()}`;

    // Open session
    await client.callTool({
      name: 'session.open',
      arguments: {
        id: sessionId,
        url: 'https://example.com',
      },
    });

    // Extract text
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

  test('extract.html extracts page HTML', async ({ client }) => {
    const sessionId = `html-${randomUUID()}`;

    // Open session
    await client.callTool({
      name: 'session.open',
      arguments: {
        id: sessionId,
        url: 'https://example.com',
      },
    });

    // Extract HTML
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
  test('workflow.scrape extracts structured data', async ({ client }) => {
    const sessionId = `scrape-${randomUUID()}`;

    // Open session
    await client.callTool({
      name: 'session.open',
      arguments: {
        id: sessionId,
        url: 'https://example.com',
      },
    });

    // Scrape data
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
