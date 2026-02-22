import { launchPersistentContext, navigate } from '../upstream/wrapper.js'
import * as pool from '../core/pool.js'
import * as storage from '../core/storage.js'
import { VIEWPORT, USER_AGENT, LOCALE, TIMEZONE } from '../config.js'
import { log } from '../utils/logger.js'

// Derive a deterministic CDP port from session id.
// Range 20000–29999 — avoids common service ports, gives 10 000 slots.
const cdpPortForId = id => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return 20000 + (Math.abs(h) % 10000)
}

export const open = async args => {
  const { id, url, config = {} } = args

  // If session already exists in pool, reuse it
  if (pool.has(id)) {
    log(`Reusing existing session: ${id}`)
    const session = pool.get(id)

    // Check if context is still alive
    try {
      if (session.context._closed || session.page.isClosed()) {
        log(`Session ${id} context was closed, removing from pool`)
        pool.remove(id)
      } else {
        // Session is alive, optionally navigate
        if (url) {
          await navigate(session.page, url)
          await storage.updateMeta(id, { lastUrl: url })
        }
        return { success: true, id, url, reused: true }
      }
    } catch (err) {
      log(`Session ${id} check failed, removing from pool: ${err.message}`)
      pool.remove(id)
    }
  }

  await storage.ensureSessionsDir()

  // Use userDataDir for complete profile persistence
  const userDataDir = storage.getUserDataDir(id)

  // Deterministic CDP port — same session id always maps to same port
  const cdpPort = cdpPortForId(id)

  // Launch persistent context (combines browser + context with userDataDir)
  // Always enable stealth mode
  const context = await launchPersistentContext(userDataDir, {
    stealth: true,
    viewport: config.viewport || VIEWPORT,
    userAgent: config.userAgent || USER_AGENT,
    locale: config.locale || LOCALE,
    timezoneId: config.timezone || TIMEZONE,
    headless: config.headless,
    cdpPort,
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

  // Listen for context close event (e.g., user manually closes browser)
  context.on('close', () => {
    log(`Context ${id} was closed manually or by user`)
    if (pool.has(id)) {
      pool.remove(id)
    }
  })

  // launchPersistentContext creates a context with existing pages
  // Get the first page or create new one
  const pages = context.pages()
  const page = pages.length > 0 ? pages[0] : await context.newPage()

  pool.add(id, context, page, cdpPort)

  const meta = {
    id,
    created: Date.now(),
    lastUsed: Date.now(),
    config,
    userDataDir,
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

  // Wrap with error handling in case context is already closed
  try {
    const session = pool.get(id)

    // userDataDir automatically persists everything, no need to save storageState
    // Just update metadata and close
    await storage.updateMeta(id, { lastUsed: Date.now() })
    await session.context.close()
    pool.remove(id)

    return { success: true, id }
  } catch (err) {
    // If context is already closed or session not found, just remove from pool
    if (pool.has(id)) {
      pool.remove(id)
    }

    if (err.message?.includes('closed')) {
      log(`Session ${id} was already closed`)
      return { success: true, id, alreadyClosed: true }
    }

    throw err
  }
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

export const endpoint = async args => {
  const { id } = args
  const session = pool.get(id)

  const cdpEndpoint = `http://localhost:${session.cdpPort}`

  return {
    sessionId: id,
    cdpEndpoint,
    // Connect from Playwright: chromium.connectOverCDP(cdpEndpoint)
  }
}

export const deleteSession = async args => {
  const { id } = args

  if (pool.has(id)) {
    await close({ id, save: false })
  }

  await storage.deleteSession(id)
  return { success: true, id }
}
