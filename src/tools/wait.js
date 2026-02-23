import * as pool from '../core/pool.js'

export const forClose = async args => {
  const { id } = args
  const session = pool.get(id)

  await session.page.waitForEvent('close', { timeout: 0 })

  return { success: true, message: 'Page closed by user' }
}

export const forSelector = async args => {
  const { id, selector, timeout = 30000 } = args
  const session = pool.get(id)

  await session.page.waitForSelector(selector, { timeout })

  return { success: true, selector }
}

export const forTimeout = async args => {
  const { id, ms } = args
  const session = pool.get(id)

  await session.page.waitForTimeout(ms)

  return { success: true, waited: ms }
}
