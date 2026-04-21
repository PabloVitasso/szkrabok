// @szkrabok/runtime — public API
// Do NOT expose: pool internals, storage internals, stealth utilities

export { launch, launchClone, connect, checkBrowser, cloneFromLive } from './launch.js';
export { closeSession, destroyClone, getSession, listSessions as listRuntimeSessions, listStoredSessions, updateSessionMeta, deleteStoredSession, updateSessionPage, closeAllSessions, computeConfigHash } from './sessions.js';
export { resolvePreset, getPresets, initConfig, initConfigProvisional, finalizeConfig, getConfig, getConfigSource, getConfigMeta, findChromiumPath } from './config.js';
export { validateCandidate, resolveChromium, buildCandidates, populateCandidates } from './resolve.js';
export { BrowserNotFoundError, ConfigNotInitializedError, ConfigNotFinalError } from './errors.js';

// MCP client
export { mcpConnect } from './mcp-client/mcp-tools.js';
export { spawnClient } from './mcp-client/runtime/transport.js';
