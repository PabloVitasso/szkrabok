import { getSession } from '#runtime';

export const scrape = async ({ sessionName, selectors = [] }) => {
  const { page } = getSession(sessionName);

  const blocks = await page.evaluate(userSelectors => {
    const norm = t => t.replace(/\s+/g, ' ').trim();

    const targets = (() => {
      if (userSelectors.length > 0) {
        return [...document.querySelectorAll(userSelectors.join(','))];
      }
      return [document.querySelector('main') || document.body];
    })();

    const result = [];
    const seenText = new Set();

    targets.forEach(root => {
      root.querySelectorAll('nav, footer, script, style, .ads, #cookies')
        .forEach(n => n.remove());

      root.querySelectorAll('p, li, h1, h2, h3, table').forEach(el => {
        const text = norm(el.innerText || '');
        if (text.length < 20 || seenText.has(text)) return;

        const linkChars = [...el.querySelectorAll('a')]
          .reduce((sum, a) => sum + a.innerText.length, 0);
        const linkRatio = linkChars / (text.length || 1);

        if (linkRatio < 0.6) {
          result.push({ tag: el.tagName.toLowerCase(), text });
          seenText.add(text);
        }
      });
    });

    return result;
  }, selectors);

  const llmFriendly = blocks.map(b => `[${b.tag}]: ${b.text}`).join('\n');

  return {
    raw: blocks,
    llmFriendly,
    tokenCountEstimate: Math.ceil(llmFriendly.length / 4),
  };
};
