// MCP-layer config — request timeouts and logging only.
// Browser launch config (presets, stealth, headless, UA, viewport) lives in
// @szkrabok/runtime. Do not re-add browser concerns here.

// Config is discovered lazily: initConfig(roots) must be called before getConfig().
// src/index.js calls initConfig([]) on startup and again after MCP roots arrive.
export { initConfig, getConfig } from '#runtime';

export const DEFAULT_TIMEOUT = 30000;
