import fs from 'fs'
import { parse } from 'smol-toml'
import type { paths as PathsType } from './paths'

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    result[key] =
      isPlainObject(base[key]) && isPlainObject(override[key])
        ? deepMerge(
            base[key] as Record<string, unknown>,
            override[key] as Record<string, unknown>,
          )
        : override[key]
  }
  return result
}

export interface ResolvedToml {
  default: Record<string, unknown>
  presets: Record<string, unknown>
  raw: Record<string, unknown>
}

export function loadToml(config: typeof PathsType['config']): ResolvedToml {
  const base = fs.existsSync(config.baseToml)
    ? (parse(fs.readFileSync(config.baseToml, 'utf8')) as Record<string, unknown>)
    : {}
  const local = fs.existsSync(config.localToml)
    ? (parse(fs.readFileSync(config.localToml, 'utf8')) as Record<string, unknown>)
    : {}
  const raw = deepMerge(base, local)
  return {
    default: (raw.default as Record<string, unknown>) ?? {},
    presets: (raw.preset as Record<string, unknown>) ?? {},
    raw,
  }
}
