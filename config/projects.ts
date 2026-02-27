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

export function selftest(paths: typeof PathsType) {
  return {
    name: 'selftest',
    testDir: paths.projects.selftest,
    testMatch: '**/*.spec.js',
  }
}

export function mcp(paths: typeof PathsType) {
  return {
    name: 'mcp',
    testDir: paths.projects.mcp,
    testMatch: '**/*.mcp.spec.js',
  }
}

export function automation({ paths, preset, session, executable, env }: AutomationOptions) {
  const useLiveBrowser = !!env.cdpEndpoint

  return {
    name: 'automation',
    testDir: paths.projects.automation,
    testMatch: '**/*.spec.js',
    testIgnore: '**/*.mcp.spec.js',
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
