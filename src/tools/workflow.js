import { getSession } from '@szkrabok/runtime';

export const scrape = async args => {
  const { sessionName, selectors } = args;
  const session = getSession(sessionName);
  const page = session.page;

  const results = {};

  for (const [key, selector] of Object.entries(selectors)) {
    try {
      const elements = await page.$$(selector);
      const texts = await Promise.all(elements.map(el => el.textContent()));
      results[key] = texts.filter(Boolean);
    } catch {
      results[key] = [];
    }
  }

  return { data: results };
};
