import { getSession } from '@szkrabok/runtime';
import { TIMEOUT } from '../config.js';

const _type = (page, selector, text) => page.fill(selector, text, { timeout: TIMEOUT });
const _click = (page, selector) => page.click(selector, { timeout: TIMEOUT });
const _select = (page, selector, value) => page.selectOption(selector, value, { timeout: TIMEOUT });

export const login = async args => {
  const {
    sessionName,
    username,
    password,
    usernameSelector = 'input[type="email"], input[name="username"], input[name="email"]',
    passwordSelector = 'input[type="password"], input[name="password"]',
    submitSelector = 'button[type="submit"], input[type="submit"]',
  } = args;

  const session = getSession(sessionName);
  const page = session.page;

  await _type(page, usernameSelector, username);
  await _type(page, passwordSelector, password);
  await _click(page, submitSelector);

  await page.waitForLoadState('networkidle', { timeout: TIMEOUT }).catch(() => {});

  return { success: true };
};

export const fillForm = async args => {
  const { sessionName, fields } = args;
  const session = getSession(sessionName);
  const page = session.page;

  for (const [selector, value] of Object.entries(fields)) {
    const element = await page.$(selector);
    if (!element) continue;

    const tagName = await element.evaluate(el => el.tagName.toLowerCase());

    if (tagName === 'select') {
      await _select(page, selector, value);
    } else {
      await _type(page, selector, value);
    }
  }

  return { success: true, filled: Object.keys(fields).length };
};

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
