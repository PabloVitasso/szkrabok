import { SessionNotFoundError } from '../utils/errors.js'
import { log } from '../utils/logger.js'

const sessions = new Map()

export const add = (id, context, page, cdpPort, preset, label) => {
  sessions.set(id, { context, page, cdpPort, preset, label, createdAt: Date.now() })
}

export const get = id => {
  const session = sessions.get(id)
  if (!session) throw new SessionNotFoundError(id)

  // Check if context is still alive (only if methods exist - for real sessions)
  try {
    const contextClosed = session.context._closed === true
    const pageClosed = typeof session.page.isClosed === 'function' && session.page.isClosed()

    if (contextClosed || pageClosed) {
      log(`Session ${id} context was closed, removing from pool`)
      sessions.delete(id)
      throw new SessionNotFoundError(id, 'Session was closed. Please reopen the session.')
    }
  } catch (err) {
    if (err instanceof SessionNotFoundError) throw err
    // If check failed, assume context is closed
    log(`Session ${id} health check failed: ${err.message}`)
    sessions.delete(id)
    throw new SessionNotFoundError(id, 'Session appears to be closed. Please reopen the session.')
  }

  return session
}

export const has = id => sessions.has(id)

export const remove = id => {
  sessions.delete(id)
}

export const list = () =>
  Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    preset:    session.preset,
    label:     session.label,
    createdAt: session.createdAt,
  }))

export const closeAllSessions = async () => {
  const promises = Array.from(sessions.values()).map(s => s.context.close())
  await Promise.allSettled(promises)
  sessions.clear()
}