import fs from 'fs'
import type { paths as PathsType } from '../../config/paths'
import type { ResolvedPreset } from '../../config/preset'
import type { ResolvedSession } from '../../config/session'
import type { env as EnvType } from '../../config/env'

interface AutomationProjectOptions {
  paths: typeof PathsType
  preset: ResolvedPreset
  session: ResolvedSession
  executable: string | undefined
  env: typeof EnvType
}

export function automationProject({
  paths,
  preset,
  session,
  executable,
  env,
}: AutomationProjectOptions) {
  const useLiveBrowser = !!env.cdpEndpoint

  return {
    name: 'automation',
    testDir: paths.projects.automation,
    testMatch: '**/*.spec.js',
    testIgnore: '**/*.mcp.spec.js',
    use: {
      storageState:
        !useLiveBrowser && fs.existsSync(session.stateFile)
          ? session.stateFile
          : undefined,
      ...(!useLiveBrowser
        ? {
            userAgent: preset.userAgent,
            viewport: preset.viewport,
            locale: preset.locale,
            timezoneId: preset.timezone,
          }
        : {}),
      launchOptions: {
        ...(executable ? { executablePath: executable } : {}),
      },
    },
  }
}
