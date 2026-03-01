import { getSession } from '@szkrabok/runtime';
import * as upstream from '../upstream/wrapper.js';
import { TIMEOUT } from '../config.js';

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

  await upstream.type(page, usernameSelector, username);
  await upstream.type(page, passwordSelector, password);
  await upstream.click(page, submitSelector);

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
      await upstream.select(page, selector, value);
    } else {
      await upstream.type(page, selector, value);
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
