import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const paths = {
  root,

  config: {
    baseToml: path.join(root, 'szkrabok.config.toml'),
    localToml: path.join(root, 'szkrabok.config.local.toml'),
  },

  sessions: (id: string) => {
    const base = path.join(root, 'sessions', id)
    return {
      base,
      state: path.join(base, 'storageState.json'),
      results: path.join(base, 'test-results'),
      lastRun: path.join(base, 'last-run.json'),
    }
  },

  projects: {
    integration: path.join(root, 'tests', 'playwright', 'integration'),
    e2e: path.join(root, 'tests', 'playwright', 'e2e'),
  },

  automation: {
    setup: path.join(root, 'tests', 'playwright', 'e2e', 'setup.js'),
    teardown: path.join(root, 'tests', 'playwright', 'e2e', 'teardown.js'),
  },
}
