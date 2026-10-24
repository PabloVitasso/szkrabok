import { getSession } from '#runtime';
import { assertReadable } from './nav_guard.js';

// Content elements whose text is extracted as one block each.
const CONTENT_SELECTOR =
  'p, li, h1, h2, h3, h4, h5, h6, table, blockquote, figcaption, dt, dd, pre';
// Boilerplate subtrees that are never scraped. Applied as a non-destructive
// gate during traversal — the live DOM is never modified.
const EXCLUDE_SELECTOR = 'nav, footer, script, style, .ads, #cookies';
const MIN_BLOCK_LENGTH = 20;
const MAX_LINK_RATIO = 0.6;

/**
 * Scrape the current page into LLM-ready text blocks.
 *
 * Contract:
 *   - `selectors` match content elements OR containers; the result contains
 *     every content element that IS a match or is CONTAINED in a match.
 *     Omitting `selectors` scrapes `main` (or `body` when no `main` exists).
 *   - Blocks are in document order; each element contributes at most one
 *     block; nested content elements are merged into their carrier ancestor
 *     (the block whose text already contains them).
 *   - Read-only: the live DOM is never mutated.
 *   - Text is layout-independent and includes display:none subtrees;
 *     script/style text never leaks into blocks.
 *   - Every dropped candidate is accounted for in `stats.dropped`.
 *
 * @returns {{ raw: Array<{tag: string, text: string}>, llmFriendly: string,
 *             tokenCountEstimate: number, stats: object }}
 */
export const scrape = async ({ sessionName, selectors = [] }) => {
  const { page } = getSession(sessionName);
  assertReadable(page); // never return content of a blocked document (D7)

  const out = await page.evaluate(
    ({ userSelectors, CONTENT, EXCLUDE, MIN_LEN, MAX_LINK_RATIO }) => {
      // --- (a) resolve targets: validate each selector, union all matches
      const targets = [];
      if (userSelectors.length > 0) {
        for (const sel of userSelectors) {
          let matched;
          try {
            matched = document.querySelectorAll(sel);
          } catch {
            return { error: { code: 'INVALID_SELECTOR', message: `Invalid CSS selector: ${sel}` } };
          }
          for (const el of matched) targets.push(el);
        }
      } else {
        targets.push(document.querySelector('main') || document.body);
      }

      const stats = {
        scanned: 0,
        collected: 0,
        dropped: { excluded: 0, tooShort: 0, linkHeavy: 0, duplicate: 0, nested: 0 },
      };

      // Candidate set: matched roots that are content elements plus content
      // descendants. A Set keeps overlapping/nested roots from double-adding.
      const seenEls = new Set();
      const candidates = [];
      const add = el => {
        if (!seenEls.has(el)) {
          seenEls.add(el);
          candidates.push(el);
        }
      };
      for (const root of targets) {
        if (root.matches(CONTENT)) add(root);
        root.querySelectorAll(CONTENT).forEach(add);
      }

      // Document order across possibly overlapping roots.
      candidates.sort((a, b) => {
        if (a === b) return 0;
        return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      stats.scanned = candidates.length;

      // Layout-independent text with whitespace at element boundaries, so
      // table cells / nested runs do not fuse into one unreadable string.
      const textOf = node => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        return [...node.childNodes].map(textOf).join(' ');
      };

      const blocks = [];
      // Elements whose text is present in the output (collected blocks and
      // duplicates of them). Descendants of a carrier are nested-dropped: the
      // carrier's block already contains their text.
      const carriers = new Set();
      const seenText = new Set();

      for (const el of candidates) {
        // --- (b) gate: boilerplate subtrees are skipped, never removed
        if (el.closest(EXCLUDE)) {
          stats.dropped.excluded++;
          continue;
        }

        // --- (c) nested content is carried by a carrier ancestor, however
        // deep (e.g. li > ul > li, table > blockquote > p) — the carrier's
        // block holds the text. Walking the full chain matters when the
        // intermediate content element was itself nested- or duplicate-dropped.
        let carried = false;
        for (let anc = el.parentElement; anc; anc = anc.parentElement) {
          if (carriers.has(anc)) {
            carried = true;
            break;
          }
        }
        if (carried) {
          stats.dropped.nested++;
          continue;
        }

        // Text from a detached clone: no live-DOM mutation, no script/style
        // leakage, includes display:none subtrees (innerText drops those).
        const clone = el.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(n => n.remove());
        const text = textOf(clone).replace(/\s+/g, ' ').trim();

        if (text.length < MIN_LEN) {
          stats.dropped.tooShort++;
          continue;
        }
        if (seenText.has(text)) {
          stats.dropped.duplicate++;
          // The text is in the output via an earlier block — act as a carrier
          // so nested content is not re-emitted from here.
          carriers.add(el);
          continue;
        }

        const linkChars = [...el.querySelectorAll('a')].reduce(
          (sum, a) => sum + (a.textContent || '').length,
          0
        );
        if (linkChars / (text.length || 1) >= MAX_LINK_RATIO) {
          stats.dropped.linkHeavy++;
          continue;
        }

        blocks.push({ tag: el.tagName.toLowerCase(), text });
        seenText.add(text);
        carriers.add(el);
        stats.collected++;
      }

      return { blocks, stats };
    },
    {
      userSelectors: selectors,
      CONTENT: CONTENT_SELECTOR,
      EXCLUDE: EXCLUDE_SELECTOR,
      MIN_LEN: MIN_BLOCK_LENGTH,
      MAX_LINK_RATIO: MAX_LINK_RATIO,
    }
  );

  if (out.error) {
    const err = new Error(out.error.message);
    err.code = out.error.code;
    throw err;
  }

  const { blocks, stats } = out;
  const llmFriendly = blocks.map(b => `[${b.tag}]: ${b.text}`).join('\n');

  return {
    raw: blocks,
    llmFriendly,
    tokenCountEstimate: Math.ceil(llmFriendly.length / 4),
    stats,
  };
};
