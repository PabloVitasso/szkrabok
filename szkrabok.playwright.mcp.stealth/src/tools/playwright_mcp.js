import * as pool from '../core/pool.js'
import { resolve, dirname, join } from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { createWriteStream } from 'fs'
import { readFile, mkdir } from 'fs/promises'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const INJECT_SCRIPT = `
  window.__mcp = window.__mcp || {};
  if (!window.__mcp.refs) {
    window.__mcp.refs = new Map();
    window.__mcp.counter = 0;
  }

  window.__mcp.reset = () => {
    window.__mcp.refs.clear();
    window.__mcp.counter = 0;
  };

  window.__mcp.getRef = (el) => {
    const ref = 'e' + (++window.__mcp.counter);
    window.__mcp.refs.set(ref, el);
    return ref;
  };

  window.__mcp.getElement = (ref) => {
    return window.__mcp.refs.get(ref);
  };

  window.__mcp.snapshot = () => {
    window.__mcp.reset();
    
    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function getLabel(el) {
      return (
        el.innerText || 
        el.getAttribute('aria-label') || 
        el.getAttribute('placeholder') || 
        el.value || 
        el.getAttribute('alt') || 
        ''
      ).replace(/\\s+/g, ' ').trim().substring(0, 100);
    }

    function traverse(node, depth = 0) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\\s+/g, ' ').trim();
        if (text.length > 0) return '  '.repeat(depth) + text;
        return null;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      
      const el = node;
      if (!isVisible(el)) return null;

      const tag = el.tagName.toLowerCase();
      const label = getLabel(el);
      
      let output = [];
      let isInteractive = false;
      
      if (
        tag === 'a' || 
        tag === 'button' || 
        tag === 'input' || 
        tag === 'select' || 
        tag === 'textarea' ||
        el.getAttribute('role') === 'button' ||
        el.onclick ||
        el.getAttribute('tabindex') === '0'
      ) {
        isInteractive = true;
        const ref = window.__mcp.getRef(el);
        output.push(\`\${'  '.repeat(depth)}- \${tag} "\${label}" [ref=\${ref}]\`);
      }

      const children = [];
      for (const child of el.childNodes) {
        const res = traverse(child, depth + (isInteractive ? 1 : 0));
        if (res) children.push(res);
      }
      
      if (output.length === 0) {
        return children.join('\\n');
      }
      
      if (children.length > 0) {
        output.push(children.join('\\n'));
      }
      
      return output.join('\\n');
    }

    return traverse(document.body);
  };
`

const ensureScript = async page => {
  await page.evaluate(INJECT_SCRIPT)
}

// Core automation tools
export const snapshot = async args => {
  const { id } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  const snap = await session.page.evaluate(() => window['__mcp'].snapshot())
  return { snapshot: snap, url: session.page.url() }
}

export const click = async args => {
  const { id, ref, element, button = 'left', doubleClick = false, modifiers = [] } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
  const el = handle.asElement()

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`)
  }

  if (doubleClick) {
    await el.dblclick({ button, modifiers })
  } else {
    await el.click({ button, modifiers })
  }

  return { success: true, ref, element, url: session.page.url() }
}

export const type = async args => {
  const { id, ref, element, text, submit = false, slowly = false } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
  const el = handle.asElement()

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`)
  }

  if (slowly) {
    await el.pressSequentially(text, { delay: 100 })
  } else {
    await el.fill(text)
  }

  if (submit) {
    await el.press('Enter')
  }

  return { success: true, ref, element, text, url: session.page.url() }
}

export const navigate = async args => {
  const { id, url } = args
  const session = pool.get(id)

  await session.page.goto(url, { waitUntil: 'domcontentloaded' })
  const snap = await snapshot({ id })
  return { ...snap, url: session.page.url() }
}

export const navigate_back = async args => {
  const { id } = args
  const session = pool.get(id)

  await session.page.goBack({ waitUntil: 'domcontentloaded' })
  return { success: true, url: session.page.url() }
}

export const close = async args => {
  const { id } = args
  const session = pool.get(id)

  await session.page.close()
  return { success: true, id }
}

export const drag = async args => {
  const { id, startRef, startElement, endRef, endElement } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  const startHandle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), startRef)
  const endHandle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), endRef)

  const start = startHandle.asElement()
  const end = endHandle.asElement()

  if (!start || !end) {
    throw new Error('Start or end element not found')
  }

  await start.dragTo(end)
  return { success: true, startElement, endElement, url: session.page.url() }
}

export const hover = async args => {
  const { id, ref, element } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
  const el = handle.asElement()

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`)
  }

  await el.hover()
  return { success: true, ref, element: element || '', url: session.page.url() }
}

export const evaluate = async args => {
  const { id, function: fn, ref } = args
  const session = pool.get(id)

  let result
  if (ref) {
    await ensureScript(session.page)
    const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
    const el = handle.asElement()
    if (!el) {
      throw new Error(`Element with ref ${ref} not found`)
    }
    result = await el.evaluate(fn)
  } else {
    result = await session.page.evaluate(fn)
  }

  return { result, url: session.page.url() }
}

export const select_option = async args => {
  const { id, ref, element, values } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
  const el = handle.asElement()

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`)
  }

  await el.selectOption(values)
  return { success: true, ref, element, values, url: session.page.url() }
}

export const fill_form = async args => {
  const { id, fields } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  for (const field of fields) {
    const { ref, value } = field
    const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
    const el = handle.asElement()

    if (!el) {
      throw new Error(`Element with ref ${ref} not found`)
    }

    await el.fill(value)
  }

  return { success: true, count: fields.length, url: session.page.url() }
}

export const press_key = async args => {
  const { id, key } = args
  const session = pool.get(id)

  await session.page.keyboard.press(key)
  return { success: true, key, url: session.page.url() }
}

export const take_screenshot = async args => {
  const { id, type = 'png', filename, ref, fullPage = false } = args
  const session = pool.get(id)

  if (ref) {
    await ensureScript(session.page)
    const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
    const el = handle.asElement()
    if (!el) {
      throw new Error(`Element with ref ${ref} not found`)
    }
    await el.screenshot({ type, path: filename })
  } else {
    await session.page.screenshot({ type, path: filename, fullPage })
  }

  return { success: true, filename, type, url: session.page.url() }
}

export const wait_for = async args => {
  const { id, time, text, textGone } = args
  const session = pool.get(id)

  if (time) {
    await session.page.waitForTimeout(time * 1000)
    return { success: true, waited: time }
  }

  if (text) {
    await session.page.waitForSelector(`text=${text}`, { state: 'visible' })
    return { success: true, text }
  }

  if (textGone) {
    await session.page.waitForSelector(`text=${textGone}`, { state: 'hidden' })
    return { success: true, textGone }
  }

  return { success: false, error: 'No wait condition specified' }
}

export const resize = async args => {
  const { id, width, height } = args
  const session = pool.get(id)

  await session.page.setViewportSize({ width, height })
  return { success: true, width, height }
}

export const tabs = async args => {
  const { id, action, index } = args
  const session = pool.get(id)

  const pages = session.context.pages()

  if (action === 'list') {
    return {
      tabs: pages.map((p, i) => ({ index: i, url: p.url(), active: p === session.page })),
    }
  }

  if (action === 'new') {
    const newPage = await session.context.newPage()
    return { success: true, index: pages.length, url: newPage.url() }
  }

  if (action === 'close') {
    const pageToClose = index !== undefined ? pages[index] : session.page
    if (!pageToClose) {
      throw new Error(`No page at index ${index}`)
    }
    await pageToClose.close()
    return { success: true, index }
  }

  if (action === 'select') {
    if (index === undefined) {
      throw new Error('index required for select action')
    }
    const pageToSelect = pages[index]
    if (!pageToSelect) {
      throw new Error(`No page at index ${index}`)
    }
    pool.add(id, session.context, pageToSelect)
    return { success: true, index, url: pageToSelect.url() }
  }

  throw new Error(`Unknown action: ${action}`)
}

export const console_messages = async args => {
  const { id, level = 'info' } = args
  const session = pool.get(id)

  const messages = await session.page.evaluate(lvl => {
    const levels = ['error', 'warning', 'info', 'debug']
    const threshold = levels.indexOf(lvl)
    const logs = window['__consoleLogs']
    return logs?.filter?.(log => levels.indexOf(log.level) <= threshold) || []
  }, level)

  return { messages, url: session.page.url() }
}

export const network_requests = async args => {
  const { id, includeStatic = false } = args
  const session = pool.get(id)

  const requests = await session.page.evaluate(incStatic => {
    const reqs = window['__networkRequests']
    return reqs?.filter?.(
      req => incStatic || !req.url.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf)$/)
    ) || []
  }, includeStatic)

  return { requests, url: session.page.url() }
}

export const file_upload = async args => {
  const { id, paths = [] } = args
  const session = pool.get(id)

  const [fileChooser] = await Promise.all([
    session.page.waitForEvent('filechooser'),
  ])

  if (paths.length === 0) {
    await fileChooser.cancel()
  } else {
    await fileChooser.setFiles(paths)
  }

  return { success: true, files: paths.length }
}

export const handle_dialog = async args => {
  const { id, accept, promptText } = args
  const session = pool.get(id)

  session.page.once('dialog', async dialog => {
    if (accept) {
      await dialog.accept(promptText)
    } else {
      await dialog.dismiss()
    }
  })

  return { success: true, action: accept ? 'accept' : 'dismiss' }
}

export const run_code = async args => {
  const { id, code } = args
  const session = pool.get(id)

  const fn = eval(`(${code})`)
  const result = await fn(session.page)

  return { result, url: session.page.url() }
}

export const run_test = async args => {
  const { id, grep, params = {}, config = 'playwright-tests/playwright.config.ts' } = args

  const configPath = resolve(REPO_ROOT, config)

  // params keys are passed as TEST_* env vars so spec files can read process.env.TEST_*
  const paramEnv = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [`TEST_${k.toUpperCase()}`, String(v)])
  )
  if (!pool.has(id)) {
    throw new Error(
      `Session "${id}" is not open. Run session.open first:\n  session.open { "id": "${id}" }`
    )
  }
  const session = pool.get(id)
  if (!session.cdpPort) {
    throw new Error(
      `Session "${id}" has no CDP port — it was opened before CDP support was added. Reopen it:\n  session.close { "id": "${id}" }\n  session.open { "id": "${id}" }`
    )
  }
  const cdpEndpoint = `http://localhost:${session.cdpPort}`
  const env = { ...process.env, SZKRABOK_SESSION: id, SZKRABOK_CDP_ENDPOINT: cdpEndpoint, ...paramEnv }

  const sessionDir = join(REPO_ROOT, 'szkrabok.playwright.mcp.stealth', 'sessions', id)
  await mkdir(sessionDir, { recursive: true })
  const logFile  = join(sessionDir, 'last-run.log')
  const jsonFile = join(sessionDir, 'last-run.json')

  const playwrightArgs = ['playwright', 'test', '--config', configPath, '--timeout', '60000']
  if (grep) playwrightArgs.push('--grep', grep)

  await new Promise((resolveP, rejectP) => {
    const logStream = createWriteStream(logFile)
    const child = spawn('npx', playwrightArgs, {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // { end: false } prevents each pipe from closing logStream when its source ends;
    // we close manually in 'close' so both stdout and stderr are fully flushed first.
    child.stdout.pipe(logStream, { end: false })
    child.stderr.pipe(logStream, { end: false })

    child.on('close', () => {
      logStream.end()
      logStream.once('finish', resolveP)
    })
    child.on('error', rejectP)
  })

  // Read console log
  const log = await readFile(logFile, 'utf8').catch(() => '')

  // Read JSON report written by the json reporter to last-run.json
  const reportRaw = await readFile(jsonFile, 'utf8').catch(() => null)
  let report = null
  try { report = reportRaw ? JSON.parse(reportRaw) : null } catch { /* malformed */ }

  if (!report) {
    return { exitCode: 1, log, error: 'JSON report not found or unparseable' }
  }

  const decodeAttachment = att => {
    if (att.contentType !== 'application/json' || !att.body) return null
    try { return JSON.parse(Buffer.from(att.body, 'base64').toString('utf8')) } catch { return null }
  }

  const { stats, suites } = report
  const tests = (suites || []).flatMap(s => s.specs || []).flatMap(spec =>
    (spec.tests || []).map(t => {
      const result = t.results?.[0] ?? {}
      const attachments = (result.attachments || [])
        .filter(a => a.name === 'result')
        .map(decodeAttachment)
        .filter(Boolean)
      return {
        title: spec.title,
        status: result.status ?? 'unknown',
        error: result.error?.message ?? null,
        result: attachments.length === 1 ? attachments[0] : attachments.length > 1 ? attachments : undefined,
      }
    })
  )

  return {
    log: log.split('\n').filter(line => line.trim()),
    passed: stats?.expected ?? 0,
    failed: stats?.unexpected ?? 0,
    skipped: stats?.skipped ?? 0,
    tests,
  }
}

export const run_file = async args => {
  const { id, path: scriptPath, fn = 'default', args: scriptArgs = {} } = args
  const session = pool.get(id)

  const absolutePath = resolve(scriptPath)

  // Dynamic import - full ESM, all imports in the script work.
  // Cache-bust so re-runs always pick up file changes without restarting szkrabok.
  const mod = await import(`${absolutePath}?t=${Date.now()}`)

  const target = fn === 'default' ? mod.default : mod[fn]

  if (typeof target !== 'function') {
    const available = Object.keys(mod)
      .filter(k => typeof mod[k] === 'function')
      .join(', ')
    throw new Error(
      `Export "${fn}" not found or not a function in "${absolutePath}". Available exports: [${available}]`
    )
  }

  const result = await target(session.page, scriptArgs)
  return { fn, result, url: session.page.url() }
}

// Vision tools (coordinate-based)
export const mouse_click_xy = async args => {
  const { id, element, x, y } = args
  const session = pool.get(id)

  await session.page.mouse.click(x, y)
  return { success: true, element, x, y, url: session.page.url() }
}

export const mouse_move_xy = async args => {
  const { id, element, x, y } = args
  const session = pool.get(id)

  await session.page.mouse.move(x, y)
  return { success: true, element, x, y, url: session.page.url() }
}

export const mouse_drag_xy = async args => {
  const { id, element, startX, startY, endX, endY } = args
  const session = pool.get(id)

  await session.page.mouse.move(startX, startY)
  await session.page.mouse.down()
  await session.page.mouse.move(endX, endY)
  await session.page.mouse.up()

  return { success: true, element, startX, startY, endX, endY, url: session.page.url() }
}

// PDF tools
export const pdf_save = async args => {
  const { id, filename } = args
  const session = pool.get(id)

  const path = filename || `page-${Date.now()}.pdf`
  await session.page.pdf({ path })

  return { success: true, filename: path }
}

// Testing tools
export const generate_locator = async args => {
  const { id, ref, element } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
  const el = handle.asElement()

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`)
  }

  const locator = await session.page.locator(el).toString()
  return { locator, element, ref }
}

export const verify_element_visible = async args => {
  const { id, role, accessibleName } = args
  const session = pool.get(id)

  const locator = session.page.getByRole(role, { name: accessibleName })
  await locator.waitFor({ state: 'visible' })

  return { success: true, role, accessibleName }
}

export const verify_text_visible = async args => {
  const { id, text } = args
  const session = pool.get(id)

  const locator = session.page.getByText(text)
  await locator.waitFor({ state: 'visible' })

  return { success: true, text }
}

export const verify_list_visible = async args => {
  const { id, ref, element, items } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
  const el = handle.asElement()

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`)
  }

  const actualItems = await el.evaluate(listEl => {
    return Array.from(listEl.children).map(child => child.textContent.trim())
  })

  const matches = items.every(item => actualItems.includes(item))

  return { success: matches, element, expectedItems: items, actualItems }
}

export const verify_value = async args => {
  const { id, type, ref, element, value } = args
  const session = pool.get(id)
  await ensureScript(session.page)

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref)
  const el = handle.asElement()

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`)
  }

  let actualValue
  if (type === 'checkbox') {
    actualValue = await el.isChecked()
    const expectedValue = value === 'true'
    return { success: actualValue === expectedValue, element, expectedValue, actualValue }
  } else {
    actualValue = await el.inputValue()
    return { success: actualValue === value, element, expectedValue: value, actualValue }
  }
}

// Tracing tools
export const start_tracing = async args => {
  const { id } = args
  const session = pool.get(id)

  await session.context.tracing.start({ screenshots: true, snapshots: true })
  return { success: true }
}

export const stop_tracing = async args => {
  const { id } = args
  const session = pool.get(id)

  const path = `trace-${Date.now()}.zip`
  await session.context.tracing.stop({ path })

  return { success: true, path }
}

export const install = async () => {
  // Browser installation handled by playwright
  return { success: true, message: 'Browsers managed by Playwright' }
}
