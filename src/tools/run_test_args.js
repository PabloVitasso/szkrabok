// Test-run environment and argv for the Playwright child (hardening proposal
// D6, D9, E1, E3, E4).
// Finding E1: raw `params` spread into the child env gave the container
// code execution (NODE_OPTIONS families) and fixed-key overrides
// (PLAYWRIGHT_JSON_OUTPUT_NAME = arbitrary write). This builder is the fix.
//
// Pure: builds and returns new values. Never spawns, never mutates inputs.
// Used by run_test in szkrabok_browser.js.

import { isAbsolute } from 'node:path';
import { ValidationError } from '../utils/errors.js';

// Fixed keys the runner sets after params (D9 step 3). They always win.
export const FIXED_ENV_KEYS = Object.freeze([
  'FORCE_COLOR',
  'SZKRABOK_SESSION',
  'SZKRABOK_CDP_ENDPOINT',
  'PLAYWRIGHT_JSON_OUTPUT_NAME',
  'SZKRABOK_ATTACH_SIGNAL',
  'PLAYWRIGHT_PROJECT',
]);

// Every param reaches the spec as SZKRABOK_PARAM_<KEY> (open question 4): a
// param can never name a variable outside this namespace. The key checks
// below stay as a second layer.
export const PARAM_ENV_PREFIX = 'SZKRABOK_PARAM_';

// Key: 1-64 chars, alpha first, A-Z / 0-9 / _ after uppercasing.
const KEY_SHAPE = /^[A-Z][A-Z0-9_]{0,63}$/;

// Reserved: whole dangerous families by prefix (runtime, loader, package
// manager, dynamic linker, interpreters a spec might shell out to, szkrabok's
// own channel), plus exact shell/session names.
const RESERVED_PREFIX =
  /^(NODE_|NPM_|NPX_|LD_|DYLD_|PLAYWRIGHT_|PW_|SZKRABOK_|DEBUG|ELECTRON_|UV_|GIT_|PYTHON|PERL5|RUBY|JAVA_|JDK_)/;
const RESERVED_NAMES =
  /^(PATH|HOME|SHELL|TMPDIR|TMP|TEMP|USER|LOGNAME|DISPLAY|XAUTHORITY|SSH_AUTH_SOCK|BROWSER|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|IFS|PS4|PROMPT_COMMAND|CDPATH|GLOBIGNORE)$/;

// Inherited from the host's own npm/node invocation; must not leak into specs
// (npm_package_*/npm_lifecycle_* also expose host paths) and must not be
// re-addable below (the reserved families already block params from naming them).
const INHERITED_EXACT = new Set(['NODE_OPTIONS']);
const INHERITED_PREFIX = /^npm_/i;
const INHERITED_PARAM = new RegExp(`^${PARAM_ENV_PREFIX}`, 'i');
const isInherited = k =>
  INHERITED_EXACT.has(k) || INHERITED_PREFIX.test(k) || INHERITED_PARAM.test(k);

const isPlainObject = v =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

const MAX_VALUE_LENGTH = 4096;

const bad = message => {
  throw new ValidationError(message, 'params');
};

/**
 * Build the child env: scrubbed base → validated params (as
 * SZKRABOK_PARAM_<KEY>) → fixed keys.
 * Throws { code: 'VALIDATION_ERROR', field: 'params' } on any violation.
 */
export const buildTestEnv = ({ baseEnv = process.env, params = {}, fixed = {} } = {}) => {
  const env = {};

  for (const [k, v] of Object.entries(baseEnv ?? {})) {
    // Inherited SZKRABOK_PARAM_* too: a spec sees only this call's params.
    if (isInherited(k)) continue;
    env[k] = v;
  }

  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    bad('params must be an object');
  }
  if (!isPlainObject(fixed)) {
    throw new ValidationError('fixed must be a plain object', 'fixed');
  }

  const seen = new Map();
  for (const [rawKey, rawValue] of Object.entries(params)) {
    const key = String(rawKey).toUpperCase();

    // { url, URL } would silently pick one: refuse as ambiguous.
    if (seen.has(key)) {
      bad(
        `params keys ${JSON.stringify(seen.get(key))} and ${JSON.stringify(rawKey)} collide after uppercasing`
      );
    }
    seen.set(key, rawKey);

    if (!KEY_SHAPE.test(key)) {
      bad(`params key ${JSON.stringify(rawKey)} must match ${KEY_SHAPE} after uppercasing`);
    }
    if (RESERVED_PREFIX.test(key) || RESERVED_NAMES.test(key)) {
      bad(`params key ${JSON.stringify(key)} is reserved`);
    }

    let value;
    if (typeof rawValue === 'string') value = rawValue;
    else if (
      (typeof rawValue === 'number' && Number.isFinite(rawValue)) ||
      typeof rawValue === 'boolean'
    ) {
      value = String(rawValue);
    } else {
      bad(`params.${key} must be a string, finite number or boolean`);
    }

    if (value.length > MAX_VALUE_LENGTH) {
      bad(`params.${key} value exceeds ${MAX_VALUE_LENGTH} chars`);
    }
    if (value.includes('\0')) {
      bad(`params.${key} value contains NUL`);
    }

    env[PARAM_ENV_PREFIX + key] = value;
  }

  // Fixed last: a same-named param can never clobber a runner-set key.
  for (const [k, v] of Object.entries(fixed)) {
    env[k] = v;
  }

  return env;
};

// ── argv ──────────────────────────────────────────────────────────────────────

const assertOptionValue = (name, value) => {
  if (typeof value !== 'string' || value === '' || value.startsWith('-') || value.includes('\0')) {
    throw new ValidationError(`${name} must be a non-empty string not starting with "-"`, name);
  }
};

/**
 * Arguments for `playwright test`. `configPath`, `outputDir` and `files` must
 * already be confined absolute paths. An absolute path cannot be parsed as an
 * option, which is what keeps caller strings out of the option space (E3).
 * Playwright 1.63 does not honour a "--" separator (files after it match
 * nothing), so none is used; non-absolute files are refused instead.
 *
 * Confined mode passes outputDir and updateSnapshots:'none' so a run never
 * writes into the spec root (E4). Legacy mode omits both and the config decides.
 */
export const buildTestArgv = ({
  configPath,
  outputDir,
  updateSnapshots,
  files = [],
  project,
  workers,
  grep,
}) => {
  if (project !== undefined) assertOptionValue('project', project);
  if (grep !== undefined && (typeof grep !== 'string' || grep.includes('\0'))) {
    throw new ValidationError('grep must be a string', 'grep');
  }
  if (workers !== undefined && !(Number.isInteger(workers) && workers > 0 && workers <= 64)) {
    throw new ValidationError('workers must be an integer between 1 and 64', 'workers');
  }
  if (!Array.isArray(files) || files.some(f => typeof f !== 'string' || !isAbsolute(f))) {
    throw new ValidationError('files must be absolute paths (resolved by the caller)', 'files');
  }

  return [
    'test',
    '--config',
    configPath,
    ...(outputDir !== undefined ? ['--output', outputDir] : []),
    ...(updateSnapshots !== undefined ? [`--update-snapshots=${updateSnapshots}`] : []),
    '--reporter',
    'list,json',
    '--timeout',
    '60000',
    ...(project !== undefined ? ['--project', project] : []),
    ...(workers !== undefined ? ['--workers', String(workers)] : []),
    // --grep=<value> keeps a leading "-" in the pattern from being read as a flag
    ...(grep !== undefined ? [`--grep=${grep}`] : []),
    ...files,
  ];
};

// ── reportFile ────────────────────────────────────────────────────────────────

/** reportFile is a plain file name inside the session's reports dir. */
const REPORT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;

export const assertReportName = name => {
  if (typeof name !== 'string' || !REPORT_NAME.test(name)) {
    throw new ValidationError(
      `reportFile must be a file name matching ${REPORT_NAME} (no directories); it is written under <work-root>/reports/<session>/`,
      'reportFile'
    );
  }
  return name;
};
