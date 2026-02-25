import fs from 'fs'
import os from 'os'
import path from 'path'
import { chromium } from 'playwright/test'

export function resolveExecutable(): string | undefined {
  const expectedPath = chromium.executablePath()
  if (fs.existsSync(expectedPath)) return undefined

  const cacheDir =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(os.homedir(), '.cache', 'ms-playwright')

  if (!fs.existsSync(cacheDir)) return undefined

  const rel = path.relative(cacheDir, expectedPath)
  const parts = rel.split(path.sep)
  if (parts.length < 2) return undefined

  const expectedDir = parts[0]
  const exeRelPath = parts.slice(1).join(path.sep)
  const prefix = expectedDir.replace(/-?\d+$/, '-')

  const installed = fs
    .readdirSync(cacheDir)
    .filter(d => d.startsWith(prefix))
    .map(d => ({ dir: d, num: parseInt(d.replace(prefix, ''), 10) }))
    .filter(e => !isNaN(e.num))
    .sort((a, b) => b.num - a.num)

  for (const entry of installed) {
    const candidate = path.join(cacheDir, entry.dir, exeRelPath)
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}
