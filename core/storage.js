import { readFile, writeFile, mkdir, rm, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const SESSIONS_DIR = './sessions'

const getSessionDir = id => join(SESSIONS_DIR, id)
const getStatePath = id => join(getSessionDir(id), 'state.json')
const getMetaPath = id => join(getSessionDir(id), 'meta.json')

export const ensureSessionsDir = async () => {
  if (!existsSync(SESSIONS_DIR)) {
    await mkdir(SESSIONS_DIR, { recursive: true })
  }
}

export const sessionExists = id => existsSync(getSessionDir(id))

export const loadState = async id => {
  const path = getStatePath(id)
  if (!existsSync(path)) return null
  const data = await readFile(path, 'utf-8')
  return JSON.parse(data)
}

export const saveState = async (id, state) => {
  await mkdir(getSessionDir(id), { recursive: true })
  await writeFile(getStatePath(id), JSON.stringify(state, null, 2))
}

export const loadMeta = async id => {
  const path = getMetaPath(id)
  if (!existsSync(path)) return null
  const data = await readFile(path, 'utf-8')
  return JSON.parse(data)
}

export const saveMeta = async (id, meta) => {
  await mkdir(getSessionDir(id), { recursive: true })
  await writeFile(getMetaPath(id), JSON.stringify(meta, null, 2))
}

export const updateMeta = async (id, updates) => {
  const meta = (await loadMeta(id)) || {}
  const updated = { ...meta, ...updates, lastUsed: Date.now() }
  await saveMeta(id, updated)
  return updated
}

export const deleteSession = async id => {
  const dir = getSessionDir(id)
  if (existsSync(dir)) {
    await rm(dir, { recursive: true })
  }
}

export const listSessions = async () => {
  await ensureSessionsDir()
  const dirs = await readdir(SESSIONS_DIR, { withFileTypes: true })
  return dirs.filter(d => d.isDirectory()).map(d => d.name)
}