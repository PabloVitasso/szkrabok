import * as pool from '../core/pool.js';
import * as upstream from '../upstream/wrapper.js';

export const text = async args => {
  const { id, selector = null } = args;
  const session = pool.get(id);
  const content = await upstream.getText(session.page, selector);
  return { content };
};

export const html = async args => {
  const { id, selector = null } = args;
  const session = pool.get(id);
  const content = await upstream.getHtml(session.page, selector);
  return { content };
};

export const screenshot = async args => {
  const { id, path = null, fullPage = false } = args;
  const session = pool.get(id);
  const buffer = await upstream.screenshot(session.page, { path, fullPage });

  return {
    success: true,
    path,
    base64: path ? null : buffer.toString('base64'),
  };
};

export const evaluate = async args => {
  const { id, code, args: evalArgs = [] } = args;
  const session = pool.get(id);
  const result = await upstream.evaluate(session.page, code, evalArgs);
  return { result };
};
