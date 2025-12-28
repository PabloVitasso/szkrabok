import { getBrowser } from '../upstream/wrapper.js'
import * as pool from '../core/pool.js'
import * as storage from '../core/storage.js'
import { SessionExistsError } from '../utils/errors.js'
import { navigate } from '../upstream/wrapper.js'
import { VIEWPORT, USER_AGENT, LOCALE, TIMEZONE } from '../config.js'

export const open = async args => {
  const { id, url, config = {} } = args

  if (pool.has(id)) {
    throw new SessionExistsError(id)
  }

  await storage.ensureSessionsDir()

  const browser = await getBrowser({
    stealth: config.stealth !== false,
    headless: config.headless
  })
  const state = await storage.loadState(id)

  const context = await browser.newContext({
    storageState: state || undefined,
    viewport: config.viewport || VIEWPORT,
    userAgent: config.userAgent || USER_AGENT,
    locale: config.locale || LOCALE,
    timezoneId: config.timezone || TIMEZONE,
    // Inject scripts into all frames
    javaScriptEnabled: true,
  })

  // Add init script to mask iframe fingerprints
  await context.addInitScript(() => {
    // Override iframe creation to inherit stealth
    const originalCreateElement = document.createElement
    document.createElement = function (tag) {
      const el = originalCreateElement.call(document, tag)
      if (tag.toLowerCase() === 'iframe') {
        // Stealth is already applied by playwright-extra
      }
      return el
    }
  })

  const page = await context.newPage()
  pool.add(id, context, page)

  const meta = {
    id,
    created: Date.now(),
    lastUsed: Date.now(),
    config,
  }
  await storage.saveMeta(id, meta)

  if (url) {
    await navigate(page, url)
    await storage.updateMeta(id, { lastUrl: url })
  }

  return { success: true, id, url }
}

export const close = async args => {
  const { id, save = true } = args
  const session = pool.get(id)

  if (save) {
    const state = await session.context.storageState()
    await storage.saveState(id, state)
  }

  await storage.updateMeta(id, { lastUsed: Date.now() })
  await session.context.close()
  pool.remove(id)

  return { success: true, id }
}

export const list = async () => {
  const active = pool.list()
  const stored = await storage.listSessions()

  const sessions = stored.map(id => {
    const isActive = active.find(a => a.id === id)
    return {
      id,
      active: !!isActive,
      createdAt: isActive?.createdAt,
    }
  })

  return { sessions }
}

export const deleteSession = async args => {
  const { id } = args

  if (pool.has(id)) {
    await close({ id, save: false })
  }

  await storage.deleteSession(id)
  return { success: true, id }
}