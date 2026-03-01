// Page operation helpers used by MCP tools.
// Browser launch is owned by @szkrabok/runtime — not here.

import { TIMEOUT } from '../config.js';

export const navigate = async (page, url, options = {}) => {
  return page.goto(url, {
    waitUntil: options.waitUntil || 'domcontentloaded',
    timeout: options.timeout || TIMEOUT,
  });
};

export const click = async (page, selector, options = {}) => {
  return page.click(selector, {
    timeout: options.timeout || TIMEOUT,
  });
};

export const type = async (page, selector, text, options = {}) => {
  return page.fill(selector, text, {
    timeout: options.timeout || TIMEOUT,
  });
};

export const select = async (page, selector, value, options = {}) => {
  return page.selectOption(selector, value, {
    timeout: options.timeout || TIMEOUT,
  });
};

export const getText = async (page, selector = null) => {
  if (selector) {
    return page.textContent(selector);
  }
  return page.content();
};

export const getHtml = async (page, selector = null) => {
  if (selector) {
    return page.innerHTML(selector);
  }
  return page.content();
};

export const screenshot = async (page, options = {}) => {
  return page.screenshot({
    fullPage: options.fullPage || false,
    type: options.type || 'png',
    path: options.path,
  });
};

export const evaluate = async (page, code, args = []) => {
  return page.evaluate(code, ...args);
};

export const back = async page => page.goBack();

export const forward = async page => page.goForward();
