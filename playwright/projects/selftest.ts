import type { paths as PathsType } from '../../config/paths'

export function selftestProject(paths: typeof PathsType) {
  return {
    name: 'selftest',
    testDir: paths.projects.selftest,
    testMatch: '**/*.spec.js',
  }
}
