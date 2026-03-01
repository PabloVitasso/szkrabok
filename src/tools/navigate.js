
import { getSession, updateSessionMeta } from '@szkrabok/runtime';
import * as upstream from '../upstream/wrapper.js';

export const goto = async args => {
  const { sessionName, url, wait = 'domcontentloaded' } = args;
  const session = getSession(sessionName);

  await upstream.navigate(session.page, url, { waitUntil: wait });
  await updateSessionMeta(sessionName, { lastUrl: url });

  return { success: true, url };
};

export const back = async args => {
  const { sessionName } = args;
  const session = getSession(sessionName);
  await upstream.back(session.page);
  return { success: true };
};

export const forward = async args => {
  const { sessionName } = args;
  const session = getSession(sessionName);
  await upstream.forward(session.page);
  return { success: true };
};
