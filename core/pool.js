import { SessionNotFoundError } from '../utils/errors.js'

const sessions = new Map()

export const add = (id, context, page) => {
  sessions.set(id, { context, page, createdAt: Date.now() })
}

export const get = id => {
  const session = sessions.get(id)
  if (!session) throw new SessionNotFoundError(id)
  return session
}

export const has = id => sessions.has(id)

export const remove = id => {
  sessions.delete(id)
}

export const list = () =>
  Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    createdAt: session.createdAt,
  }))

export const closeAllSessions = async () => {
  const promises = Array.from(sessions.values()).map(s => s.context.close())
  await Promise.allSettled(promises)
  sessions.clear()
}