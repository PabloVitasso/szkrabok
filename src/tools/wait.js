import { getSession } from '@szkrabok/runtime';

export const forClose = async args => {
  const { sessionName } = args;
  const session = getSession(sessionName);

  await session.page.waitForEvent('close', { timeout: 0 });

  return { success: true, message: 'Page closed by user' };
};

export const forSelector = async args => {
  const { sessionName, selector, timeout = 30000 } = args;
  const session = getSession(sessionName);

  await session.page.waitForSelector(selector, { timeout });

  return { success: true, selector };
};

export const forTimeout = async args => {
  const { sessionName, ms } = args;
  const session = getSession(sessionName);

  await session.page.waitForTimeout(ms);

  return { success: true, waited: ms };
};
