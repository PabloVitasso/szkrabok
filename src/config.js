// MCP-layer config — request timeouts and logging only.
// Browser launch config (presets, stealth, headless, UA, viewport) lives in
// @szkrabok/runtime. Do not re-add browser concerns here.

// Config lifecycle: initConfigProvisional() on startup, finalizeConfig(roots) after MCP handshake.
// Use initConfig(roots) for one-shot initialization (tests, CLI).
export { initConfig, initConfigProvisional, finalizeConfig, getConfig, getConfigMeta } from '#runtime';

export const DEFAULT_TIMEOUT = 30000;
