// MCP-layer config — request timeouts and logging only.
// Browser launch config (presets, stealth, headless, UA, viewport) lives in
// @szkrabok/runtime. Do not re-add browser concerns here.

import { join, resolve, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { parse } from 'smol-toml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (base, override) => {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    result[key] =
      isPlainObject(base[key]) && isPlainObject(override[key])
        ? deepMerge(base[key], override[key])
        : override[key];
  }
  return result;
};

const TOML_PATH = join(REPO_ROOT, 'szkrabok.config.toml');
const TOML_LOCAL_PATH = join(REPO_ROOT, 'szkrabok.config.local.toml');
const tomlBase = existsSync(TOML_PATH) ? parse(readFileSync(TOML_PATH, 'utf8')) : {};
const tomlLocal = existsSync(TOML_LOCAL_PATH) ? parse(readFileSync(TOML_LOCAL_PATH, 'utf8')) : {};
const toml = deepMerge(tomlBase, tomlLocal);

const tomlDefault = toml.default ?? {};

export const DEFAULT_TIMEOUT = 30000;
export const TIMEOUT = tomlDefault.timeout ?? DEFAULT_TIMEOUT;
export const LOG_LEVEL = tomlDefault.log_level ?? 'info';
export const DISABLE_WEBGL = tomlDefault.disable_webgl ?? false;
