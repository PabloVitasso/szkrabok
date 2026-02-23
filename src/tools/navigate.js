import * as pool from '../core/pool.js'
import * as storage from '../core/storage.js'
import * as upstream from '../upstream/wrapper.js'

export const goto = async args => {
  const { id, url, wait = 'domcontentloaded' } = args
  const session = pool.get(id)

  await upstream.navigate(session.page, url, { waitUntil: wait })
  await storage.updateMeta(id, { lastUrl: url })

  return { success: true, url }
}

export const back = async args => {
  const { id } = args
  const session = pool.get(id)
  await upstream.back(session.page)
  return { success: true }
}

export const forward = async args => {
  const { id } = args
  const session = pool.get(id)
  await upstream.forward(session.page)
  return { success: true }
}
