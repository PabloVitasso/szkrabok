import type { paths as PathsType } from './paths'
import type { env as EnvType } from './env'

export interface ResolvedSession {
  id: string
  stateFile: string
  results: string
  lastRun: string
}

export function resolveSession(
  env: typeof EnvType,
  paths: typeof PathsType,
): ResolvedSession {
  const id = env.session
  const session = paths.sessions(id)
  return {
    id,
    stateFile: session.state,
    results: session.results,
    lastRun: session.lastRun,
  }
}
