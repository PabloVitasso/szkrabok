// Process-scoped session registry.
// Each process (MCP server, CLI, test runner) has its own pool.
// CDP endpoint is the cross-process identity.

import { SessionNotFoundError } from './errors.js';

const sessions = new Map();

// cdpPort is number | null (null for Firefox sessions — no CDP endpoint available)
export const add = (id, context, page, cdpPort, preset, label, isClone = false, cloneDir = null, templateName = null, leaseHandle = null, pid = null, configHash = null, browserEngine = 'chromium') => {
  sessions.set(id, { context, page, cdpPort, preset, label, createdAt: Date.now(), isClone, cloneDir, templateName, leaseHandle, pid, configHash, browserEngine });
};

export const get = id => {
  const session = sessions.get(id);
  if (!session) throw new SessionNotFoundError(id);

  try {
    const contextClosed = session.context._closed === true;
    const pageClosed = typeof session.page.isClosed === 'function' && session.page.isClosed();

    if (contextClosed || pageClosed) {
      sessions.delete(id);
      throw new SessionNotFoundError(id, 'session was closed. reopen the session.');
    }
  } catch (err) {
    if (err instanceof SessionNotFoundError) throw err;
    sessions.delete(id);
    throw new SessionNotFoundError(id, 'session appears to be closed. reopen the session.');
  }

  return session;
};

export const has = id => sessions.has(id);

export const remove = id => {
  sessions.delete(id);
};

export const list = () =>
  Array.from(sessions.entries()).map(([id, s]) => ({
    id,
    preset:        s.preset,
    label:         s.label,
    createdAt:     s.createdAt,
    isClone:       s.isClone,
    cloneDir:      s.cloneDir,
    templateName:  s.templateName,
    pid:           s.pid,
    configHash:    s.configHash,
    browserEngine: s.browserEngine,
  }));

export const closeAll = async () => {
  const promises = Array.from(sessions.values()).map(s => s.context.close());
  await Promise.allSettled(promises);
  sessions.clear();
};

