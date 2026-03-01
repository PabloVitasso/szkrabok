import fs from 'fs'
import type { paths as PathsType } from './paths'
import type { ResolvedPreset } from './preset'
import type { ResolvedSession } from './session'
import type { env as EnvType } from './env'

interface AutomationOptions {
  paths: typeof PathsType
  preset: ResolvedPreset
  session: ResolvedSession
  executable: string | undefined
  env: typeof EnvType
}

export function integration(paths: typeof PathsType) {
  return {
    name: 'integration',
    testDir: paths.projects.integration,
    testMatch: '**/*.spec.js',
  }
}

export function e2e({ paths, preset, session, executable, env }: AutomationOptions) {
  const useLiveBrowser = !!env.cdpEndpoint

  return {
    name: 'e2e',
    testDir: paths.projects.e2e,
    testMatch: '**/*.spec.js',
    use: {
      storageState:
        !useLiveBrowser && fs.existsSync(session.stateFile) ? session.stateFile : undefined,
      ...(!useLiveBrowser
        ? {
            userAgent: preset.userAgent,
            viewport: preset.viewport,
            locale: preset.locale,
            timezoneId: preset.timezone,
          }
        : {}),
      launchOptions: {
        ...((preset.executablePath ?? executable) ? { executablePath: preset.executablePath ?? executable } : {}),
        ...(preset.headless !== undefined ? { headless: preset.headless } : {}),
      },
    },
  }
}
