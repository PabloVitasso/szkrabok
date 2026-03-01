// Process-scoped session registry.
// Each process (MCP server, CLI, test runner) has its own pool.
// CDP endpoint is the cross-process identity.

const sessions = new Map();

export const add = (id, context, page, cdpPort, preset, label) => {
  sessions.set(id, { context, page, cdpPort, preset, label, createdAt: Date.now() });
};

export const get = id => {
  const session = sessions.get(id);
  if (!session) throw new SessionNotFoundError(id);

  try {
    const contextClosed = session.context._closed === true;
    const pageClosed = typeof session.page.isClosed === 'function' && session.page.isClosed();

    if (contextClosed || pageClosed) {
      sessions.delete(id);
      throw new SessionNotFoundError(id, 'Session was closed. Please reopen the session.');
    }
  } catch (err) {
    if (err instanceof SessionNotFoundError) throw err;
    sessions.delete(id);
    throw new SessionNotFoundError(id, 'Session appears to be closed. Please reopen the session.');
  }

  return session;
};

export const has = id => sessions.has(id);

export const remove = id => {
  sessions.delete(id);
};

export const list = () =>
  Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    preset: session.preset,
    label: session.label,
    createdAt: session.createdAt,
  }));

export const closeAll = async () => {
  const promises = Array.from(sessions.values()).map(s => s.context.close());
  await Promise.allSettled(promises);
  sessions.clear();
};

class SessionNotFoundError extends Error {
  constructor(id, customMessage = null) {
    super(customMessage || `Session not found: ${id}`);
    this.name = 'SessionNotFoundError';
    this.code = 'SESSION_NOT_FOUND';
    this.sessionId = id;
  }
}
