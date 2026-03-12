import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Platform-aware cache/runtime-data directory for szkrabok.
 *   Linux/macOS: $XDG_CACHE_HOME/szkrabok  (~/.cache/szkrabok)
 *   Windows:     %LOCALAPPDATA%\szkrabok
 */
export const szkrabokCacheDir = () => {
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'szkrabok');
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'szkrabok');
};
