import * as pool from '../core/pool.js'
import { resolve, dirname, join } from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { createWriteStream } from 'fs'
import { readFile, mkdir } from 'fs/promises'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const run_test = async args => {
  const { id, grep, params = {}, config = 'playwright-tests/playwright.config.ts' } = args

  const configPath = resolve(REPO_ROOT, config)

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

  const sessionDir = join(REPO_ROOT, 'sessions', id)
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

    child.stdout.pipe(logStream, { end: false })
    child.stderr.pipe(logStream, { end: false })

    child.on('close', () => {
      logStream.end()
      logStream.once('finish', resolveP)
    })
    child.on('error', rejectP)
  })

  const log = await readFile(logFile, 'utf8').catch(() => '')

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
