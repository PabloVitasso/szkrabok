import type { paths as PathsType } from '../../config/paths'

export function clientProject(paths: typeof PathsType) {
  return {
    name: 'client',
    testDir: paths.projects.client,
    testMatch: '**/*.mcp.spec.js',
  }
}
