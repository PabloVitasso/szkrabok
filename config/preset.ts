import type { ResolvedToml } from './toml'
import type { env as EnvType } from './env'

export interface ResolvedPreset {
  userAgent: string | undefined
  viewport: { width: number; height: number } | undefined
  locale: string | undefined
  timezone: string | undefined
  headless: boolean | undefined
  executablePath: string | undefined
}

export function resolvePreset(
  toml: ResolvedToml,
  env: typeof EnvType,
): ResolvedPreset {
  const override =
    env.preset !== 'default'
      ? ((toml.presets[env.preset] ?? {}) as Record<string, unknown>)
      : {}

  const viewportRaw = (override.viewport ?? toml.default.viewport) as
    | { width: number; height: number }
    | undefined

  return {
    userAgent: (override.userAgent ?? toml.default.userAgent) as
      | string
      | undefined,
    viewport: viewportRaw
      ? { width: viewportRaw.width, height: viewportRaw.height }
      : undefined,
    locale: (override.locale ?? toml.default.locale) as string | undefined,
    timezone: (override.timezone ?? toml.default.timezone) as
      | string
      | undefined,
    headless: (override.headless ?? toml.default.headless) as
      | boolean
      | undefined,
    executablePath: (override.executablePath ?? toml.default.executablePath) as
      | string
      | undefined,
  }
}
