import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { overlaps } from './utils/paths.js';

// Server-mode capability flags (hardening proposal D1).
// Read from argv only — never from tool arguments, toml, or env.

export class InvalidFlagsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidFlagsError';
    this.code = 'INVALID_FLAGS';
  }
}

const PATH_FLAGS = new Set(['--work-root', '--spec-root']);
const BOOL_FLAGS = new Set(['--allow-node-code', '--allow-private-net', '--trust-project-config']);
// Typos in a capability flag must refuse startup, not silently change posture.
const GUARDED_PREFIXES = ['--allow-', '--trust-'];
// Pre-existing server flags that take a value; skipped so their value is not
// mistaken for a stray argument.
const OTHER_VALUE_FLAGS = new Set(['--config']);

const realDir = (flag, p) => {
  if (!isAbsolute(p)) throw new InvalidFlagsError(`${flag} must be an absolute path, got "${p}"`);
  let real;
  try {
    real = realpathSync(p);
  } catch {
    throw new InvalidFlagsError(`${flag} does not exist: ${p}`);
  }
  if (!statSync(real).isDirectory())
    throw new InvalidFlagsError(`${flag} is not a directory: ${p}`);
  return real;
};

export const parseFlags = (argv, { cwd = process.cwd() } = {}) => {
  const raw = {};
  const bools = new Set();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const name = arg.startsWith('--') && eq !== -1 ? arg.slice(0, eq) : arg;

    if (PATH_FLAGS.has(name)) {
      let value;
      if (eq !== -1 && name !== arg) value = arg.slice(eq + 1);
      else value = argv[++i];
      if (!value || value.startsWith('--')) throw new InvalidFlagsError(`${name} requires a value`);
      raw[name] = value;
    } else if (BOOL_FLAGS.has(arg)) {
      bools.add(arg);
    } else if (GUARDED_PREFIXES.some(p => arg.startsWith(p))) {
      throw new InvalidFlagsError(`unknown flag ${arg}`);
    } else if (OTHER_VALUE_FLAGS.has(arg)) {
      i++;
    }
  }

  const workRoot = raw['--work-root']
    ? realDir('--work-root', raw['--work-root'])
    : realpathSync(cwd);
  const specRoot = raw['--spec-root'] ? realDir('--spec-root', raw['--spec-root']) : null;

  if (specRoot && overlaps(workRoot, specRoot)) {
    throw new InvalidFlagsError(
      `--work-root (${workRoot}) and --spec-root (${specRoot}) must be disjoint`
    );
  }

  return {
    workRoot,
    specRoot,
    allowNodeCode: bools.has('--allow-node-code'),
    allowPrivateNet: bools.has('--allow-private-net'),
    trustProjectConfig: bools.has('--trust-project-config'),
  };
};

/** The D1 capability matrix. */
export const capabilities = flags => {
  const node = flags.allowNodeCode;
  const spec = !!flags.specRoot;
  return {
    browserRunCode: node ? 'node' : 'page',
    browserRunPath: node ? 'node' : spec ? 'page' : 'off',
    testTools: node ? 'unconfined' : spec ? 'confined' : 'off',
    scaffoldInit: node,
    privateNet: flags.allowPrivateNet,
    // Load szkrabok.config.toml from MCP roots / cwd. Off by default: a cloned
    // repo could name an executable that every session open would launch.
    projectConfig: !!flags.trustProjectConfig,
  };
};

// ── process-wide active flags ─────────────────────────────────────────────────
// Set once by src/index.js in server mode. Library/CLI use without
// setFlags() gets the most permissive legacy behaviour only when the caller
// opts in explicitly; the default is the fail-closed server posture.

let _active = null;

export const setFlags = flags => {
  _active = flags;
};

export const getFlags = () => {
  if (!_active) _active = parseFlags([]);
  return _active;
};

export const getCapabilities = () => capabilities(getFlags());

export const _resetFlagsForTesting = () => {
  _active = null;
};
