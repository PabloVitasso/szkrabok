import { getSession } from '@szkrabok/runtime';
import * as upstream from '../upstream/wrapper.js';

export const text = async args => {
  const { sessionName, selector = null } = args;
  const session = getSession(sessionName);
  const content = await upstream.getText(session.page, selector);
  return { content };
};

export const html = async args => {
  const { sessionName, selector = null } = args;
  const session = getSession(sessionName);
  const content = await upstream.getHtml(session.page, selector);
  return { content };
};

export const screenshot = async args => {
  const { sessionName, path = null, fullPage = false } = args;
  const session = getSession(sessionName);
  const buffer = await upstream.screenshot(session.page, { path, fullPage });

  return {
    success: true,
    path,
    base64: path ? null : buffer.toString('base64'),
  };
};

export const evaluate = async args => {
  const { sessionName, code, args: evalArgs = [] } = args;
  const session = getSession(sessionName);
  const result = await upstream.evaluate(session.page, code, evalArgs);
  return { result };
};
