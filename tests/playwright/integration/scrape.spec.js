/**
 * Szkrabok browser_scrape — contract suite (SCRAPE-1..12)
 *
 * Regression tests for defects found while scraping wp.pl:
 *
 *   1. selectors matching leaf content elements (h3, p, ...) return 0 blocks,
 *      because collection only walks *descendants* of the matched elements.
 *   2. scrape destructively removes nav, footer, script, style, .ads, #cookies
 *      nodes from the live page DOM, breaking any later interaction.
 *   3. the content tag set (p, li, h1-h3, table) silently drops h4-h6 and other
 *      block content; innerText silently drops display:none text; filters drop
 *      blocks without reporting; nested blocks are double-captured; an invalid
 *      selector kills the whole scrape with a raw SyntaxError.
 *
 * Contract under test:
 *   - selectors match content elements OR containers; the scrape returns text
 *     of every content element that IS a match or is CONTAINED in a match
 *   - blocks are in document order, each element contributes at most one block
 *   - scrape is read-only (never mutates the live DOM)
 *   - text includes hidden (display:none) subtrees; script/style/noscript never leaks
 *   - every dropped block is accounted for in stats.dropped
 *
 * All tests use self-contained data: URL fixtures — no network, deterministic.
 */

import { test, expect } from './fixtures.js';
import { randomUUID } from 'crypto';

// Every expected block text is >= 20 chars (MIN_BLOCK_LENGTH) and link-free
// (MAX_LINK_RATIO) so expectations are deterministic.
const FIXTURE_BASIC = `<html><body><main>
  <h3>Heading alpha content here now</h3>
  <p>Paragraph beta content goes here now</p>
</main></body></html>`;

const scrape = async (client, sessionName, args = {}) => {
  const response = await client.callTool({
    name: 'browser_scrape',
    arguments: { sessionName, ...args },
  });
  return response;
};

const scrapeJson = async (client, sessionName, args = {}) => {
  const response = await scrape(client, sessionName, args);
  expect(response.isError).toBeFalsy();
  return JSON.parse(response.content[0].text);
};

const runJs = async (client, sessionName, code) => {
  const response = await client.callTool({
    name: 'browser_run',
    arguments: { sessionName, code },
  });
  // A failed browser_run must fail the test, not leave a half-set fixture (R2).
  expect(response.isError, response.content?.[0]?.text).toBeFalsy();
  return JSON.parse(response.content[0].text).result;
};

const countDom = client => sessionName =>
  runJs(
    client,
    sessionName,
    'async page => ({ nav: await page.locator("nav").count(), ' +
      'footer: await page.locator("footer").count(), ' +
      'style: await page.locator("style").count() })'
  );

// Fixtures are written with document.write: data: URLs are refused by the
// navigation guard (hardening proposal D7), and the document stays at
// about:blank, which browser_scrape accepts.
//
// Not page.setContent (R2): it waits for a console.debug tag, which arrives
// via Runtime.consoleAPICalled, and the rebrowser patch suppresses
// Runtime.enable. So setContent always hit its 30s timeout here.
const openFixture = async (client, openSession, kind, html) => {
  const sessionId = `scrape-${kind}-${randomUUID()}`;
  await openSession(client, sessionId);
  await runJs(
    client,
    sessionId,
    `async page => { await page.evaluate(html => { document.open(); document.write(html); document.close(); }, ${JSON.stringify(html)}); }`
  );
  return sessionId;
};

const close = (client, sessionId) =>
  client.callTool({
    name: 'session_manage',
    arguments: { action: 'close', sessionName: sessionId, save: false },
  });

test.describe('browser_scrape — contract suite', () => {
  test('SCRAPE-1: selectors matching leaf content elements return their text', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(client, openSession, 'leaf', FIXTURE_BASIC);

    // h3 and p are the elements the user selected — their own text must be
    // returned, not just text of elements nested inside them.
    const out = await scrapeJson(client, sessionId, { selectors: ['h3', 'p'] });

    expect(out.raw.map(b => b.text)).toEqual([
      'Heading alpha content here now',
      'Paragraph beta content goes here now',
    ]);
    expect(out.llmFriendly).toContain('[h3]: Heading alpha content here now');

    await close(client, sessionId);
  });

  test('SCRAPE-2: selectors matching containers collect descendant blocks', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(client, openSession, 'container', FIXTURE_BASIC);

    // Control case: container selector must keep working after the fix.
    const out = await scrapeJson(client, sessionId, { selectors: ['main'] });

    expect(out.raw.map(b => b.text)).toEqual([
      'Heading alpha content here now',
      'Paragraph beta content goes here now',
    ]);

    await close(client, sessionId);
  });

  test('SCRAPE-3: scrape does not mutate the live page DOM', async ({ client, openSession }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'mutation',
      `<html><body>
      <nav><a href="#nav">navigation link target text</a></nav>
      <style>.x { color: red; }</style>
      <main>
        <h3>Heading alpha content here now</h3>
        <p>Paragraph beta content goes here now</p>
        <footer>footer text placeholder here</footer>
      </main>
    </body></html>`
    );

    const count = countDom(client);
    const before = await count(sessionId);
    expect(before).toEqual({ nav: 1, footer: 1, style: 1 });

    // Both modes: selectors mode and auto mode are read operations.
    await scrapeJson(client, sessionId, { selectors: ['body'] });
    await scrapeJson(client, sessionId);

    const after = await count(sessionId);
    expect(after).toEqual(before);

    await close(client, sessionId);
  });

  test('SCRAPE-4: heading levels h4-h6 are collected', async ({ client, openSession }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'headings',
      `<html><body><main>
      <h4>Fourth level heading content here</h4>
      <h5>Fifth level heading content here now</h5>
      <h6>Sixth level heading content is here</h6>
    </main></body></html>`
    );

    // LLM-ready output must not silently drop deeper heading levels.
    const out = await scrapeJson(client, sessionId, { selectors: ['main'] });

    expect(out.raw.map(b => b.text)).toEqual([
      'Fourth level heading content here',
      'Fifth level heading content here now',
      'Sixth level heading content is here',
    ]);

    await close(client, sessionId);
  });

  test('SCRAPE-5: mixed selectors — union, dedupe across nested roots, document order', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'mixed',
      `<html><body><main>
      <h3>First heading content here now</h3>
      <article>
        <h3>Second heading content here now</h3>
        <p>Second paragraph content here now</p>
      </article>
      <p>Third paragraph content here now</p>
    </main></body></html>`
    );

    // 'h3' matches the second heading directly AND it is inside 'article':
    // one block each, in document order. Third paragraph is outside all matches.
    const out = await scrapeJson(client, sessionId, { selectors: ['article', 'h3'] });

    expect(out.raw.map(b => b.text)).toEqual([
      'First heading content here now',
      'Second heading content here now',
      'Second paragraph content here now',
    ]);

    await close(client, sessionId);
  });

  test('SCRAPE-6: boilerplate exclusion applies in selectors mode', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'boilerplate',
      `<html><body><main>
      <nav><p>Navigation boilerplate paragraph text here</p></nav>
      <footer><p>Footer boilerplate paragraph text here</p></footer>
      <p>Real content paragraph lives here now</p>
    </main></body></html>`
    );

    const out = await scrapeJson(client, sessionId, { selectors: ['body'] });

    expect(out.raw.map(b => b.text)).toEqual(['Real content paragraph lives here now']);
    expect(out.stats.dropped.excluded).toBe(2);

    await close(client, sessionId);
  });

  test('SCRAPE-7: explicitly selected boilerplate is still excluded', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'footer-root',
      `<html><body>
      <footer><p>Footer boilerplate paragraph text here</p></footer>
    </body></html>`
    );

    // Exclusion policy is consistent: matched roots are gated like descendants.
    const out = await scrapeJson(client, sessionId, { selectors: ['footer'] });

    expect(out.raw).toEqual([]);
    expect(out.stats.dropped.excluded).toBe(1);

    await close(client, sessionId);
  });

  test('SCRAPE-8: hidden (display:none) text is included; script/style text never leaks', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'hidden',
      `<html><body><main>
      <p>Visible intro text here <span style="display:none">plus hidden tail text</span>
        <script>var secretScriptText = 'do not leak this';</script>
        <noscript>noscript fallback text leak check</noscript></p>
    </main></body></html>`
    );

    const out = await scrapeJson(client, sessionId, { selectors: ['main'] });

    expect(out.raw).toHaveLength(1);
    expect(out.raw[0].text).toContain('Visible intro text here');
    expect(out.raw[0].text).toContain('plus hidden tail text');
    expect(out.raw[0].text).not.toContain('secretScriptText');
    expect(out.raw[0].text).not.toContain('noscript fallback text');

    await close(client, sessionId);
  });

  test('SCRAPE-9: stats.dropped accounts for every filtered block', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'stats',
      `<html><body><main>
      <p>Kept paragraph content is here now</p>
      <p>tiny</p>
      <p><a href="#x">linked content text here now</a></p>
      <p>Kept paragraph content is here now</p>
      <ul><li>Outer list item content here now<ul><li>Inner list item content here</li></ul></li></ul>
    </main></body></html>`
    );

    const out = await scrapeJson(client, sessionId, { selectors: ['main'] });

    expect(out.stats.scanned).toBe(6);
    expect(out.stats.collected).toBe(2);
    expect(out.stats.dropped).toEqual({
      excluded: 0,
      tooShort: 1,
      linkHeavy: 1,
      duplicate: 1,
      nested: 1,
    });

    // Accounting invariant: every scanned candidate lands in exactly one bucket.
    const droppedTotal = Object.values(out.stats.dropped).reduce((a, b) => a + b, 0);
    expect(out.stats.scanned).toBe(out.stats.collected + droppedTotal);

    await close(client, sessionId);
  });

  test('SCRAPE-10: nested content elements produce no duplicate blocks', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'nested',
      `<html><body><main>
      <ul><li>Outer list item content here now<ul><li>Inner list item content here</li></ul></li></ul>
    </main></body></html>`
    );

    const out = await scrapeJson(client, sessionId, { selectors: ['main'] });

    // One block: the outer li carries the inner li's text too.
    expect(out.raw).toHaveLength(1);
    expect(out.raw[0].text).toContain('Outer list item content here now');
    expect(out.raw[0].text).toContain('Inner list item content here');

    await close(client, sessionId);
  });

  test('SCRAPE-11: table is collected atomically as one block', async ({ client, openSession }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'table',
      `<html><body><main>
      <table>
        <tr><td>Cell one content here now</td><td>Cell two content here now</td></tr>
        <tr><td>Cell three content is here</td><td>Cell four content is here</td></tr>
      </table>
    </main></body></html>`
    );

    const out = await scrapeJson(client, sessionId, { selectors: ['main'] });

    expect(out.raw).toHaveLength(1);
    expect(out.raw[0].tag).toBe('table');
    for (const cell of [
      'Cell one content here now',
      'Cell two content here now',
      'Cell three content is here',
      'Cell four content is here',
    ]) {
      expect(out.raw[0].text).toContain(cell);
    }

    await close(client, sessionId);
  });

  test('SCRAPE-13: deeply nested content merges into one carrier block', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'chain',
      `<html><body><main>
      <table><tr><td><blockquote><p>Cell paragraph content here now</p></blockquote></td></tr></table>
    </main></body></html>`
    );

    const out = await scrapeJson(client, sessionId, { selectors: ['main'] });

    // table > blockquote > p: the intermediate blockquote is itself
    // nested-dropped, yet the p must still merge into the table carrier.
    expect(out.raw).toHaveLength(1);
    expect(out.raw[0].tag).toBe('table');
    expect(out.raw[0].text).toContain('Cell paragraph content here now');
    expect(out.stats.dropped.nested).toBe(2);

    await close(client, sessionId);
  });

  test('SCRAPE-14: auto-mode scrapes main; empty selectors array behaves the same', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'auto-main',
      `<html><body>
      <p>Outside main paragraph content here now</p>
      <main><p>Main area paragraph content here now</p></main>
    </body></html>`
    );

    const auto = await scrapeJson(client, sessionId);
    expect(auto.raw.map(b => b.text)).toEqual(['Main area paragraph content here now']);

    const empty = await scrapeJson(client, sessionId, { selectors: [] });
    expect(empty.raw).toEqual(auto.raw);

    await close(client, sessionId);
  });

  test('SCRAPE-15: auto-mode falls back to body when no main exists', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(
      client,
      openSession,
      'auto-body',
      `<html><body>
      <p>Body level paragraph content is here</p>
      <p>Second body paragraph content here</p>
    </body></html>`
    );

    const out = await scrapeJson(client, sessionId);
    expect(out.raw.map(b => b.text)).toEqual([
      'Body level paragraph content is here',
      'Second body paragraph content here',
    ]);

    await close(client, sessionId);
  });

  test('SCRAPE-12: invalid selector raises a structured error naming it', async ({
    client,
    openSession,
  }) => {
    const sessionId = await openFixture(client, openSession, 'bad-selector', FIXTURE_BASIC);

    const response = await scrape(client, sessionId, { selectors: [':bad('] });

    expect(response.isError).toBe(true);
    const err = JSON.parse(response.content[0].text);
    expect(err.code).toBe('INVALID_SELECTOR');
    expect(err.message).toContain(':bad(');

    await close(client, sessionId);
  });
});
