// Tool-boundary policy (hardening proposal D1/D5): capability gates and input
// validation that run before any handler touches a session, a path or a
// process. Tool arguments are hostile; capabilities come from argv only.

import { getCapabilities } from '../flags.js';
import { assertSessionName } from '../utils/validate.js';
import { ValidationError } from '../utils/errors.js';

export class CapabilityDisabledError extends Error {
  constructor(what, flag) {
    super(
      `${what} is disabled; the host operator enables this with ${flag} in the MCP server command`
    );
    this.name = 'CapabilityDisabledError';
    this.code = 'CAPABILITY_DISABLED';
    this.hint = `start szkrabok with ${flag}`;
  }
}

/** Drop test seams and any other `_`-prefixed keys (E7). */
export const scrubLaunchOptions = launchOptions => {
  if (launchOptions === undefined || launchOptions === null) return launchOptions;
  if (typeof launchOptions !== 'object' || Array.isArray(launchOptions)) {
    throw new ValidationError('launchOptions must be an object', 'launchOptions');
  }
  return Object.fromEntries(Object.entries(launchOptions).filter(([k]) => !k.startsWith('_')));
};

const SESSION_ACTION_KIND = {
  open: 'template',
  delete: 'template',
  close: 'any',
  endpoint: 'any',
};

// ── per-tool guards ───────────────────────────────────────────────────────────
// Each returns the (possibly sanitized) args, or throws.

const guards = {
  session_manage: args => {
    const kind = SESSION_ACTION_KIND[args.action];
    if (kind) assertSessionName(args.sessionName, { kind });
    if (args.action !== 'open') return args;
    return { ...args, launchOptions: scrubLaunchOptions(args.launchOptions) };
  },

  browser_scrape: args => {
    assertSessionName(args.sessionName, { kind: 'any' });
    return args;
  },

  browser_run: args => {
    assertSessionName(args.sessionName, { kind: 'any' });
    const caps = getCapabilities();
    if (args.path !== undefined && caps.browserRunPath === 'off') {
      throw new CapabilityDisabledError(
        'browser_run "path"',
        '--spec-root (page mode) or --allow-node-code'
      );
    }
    return args;
  },

  browser_run_test: args => {
    assertSessionName(args.sessionName, { kind: 'any' });
    if (getCapabilities().testTools === 'off') {
      throw new CapabilityDisabledError('browser_run_test', '--spec-root');
    }
    return args;
  },

  session_run_test: args => {
    if (!args.session || typeof args.session !== 'object') {
      throw new ValidationError('session is required', 'session');
    }
    assertSessionName(args.session.name, { kind: 'template' });
    if (getCapabilities().testTools === 'off') {
      throw new CapabilityDisabledError('session_run_test', '--spec-root');
    }
    return {
      ...args,
      session: { ...args.session, launchOptions: scrubLaunchOptions(args.session.launchOptions) },
    };
  },

  scaffold_init: args => {
    if (!getCapabilities().scaffoldInit) {
      throw new CapabilityDisabledError('scaffold_init', '--allow-node-code');
    }
    return args;
  },
};

export const guardToolCall = (name, args) => {
  const guard = guards[name];
  return guard ? guard(args ?? {}) : (args ?? {});
};

/** Short availability note prepended to tool descriptions. */
export const availabilityNote = name => {
  const caps = getCapabilities();
  switch (name) {
    case 'browser_run':
      return caps.browserRunCode === 'node'
        ? '[Node mode: code is (page, args) => ...] '
        : `[page sandbox: code is (args) => ... evaluated in the page; path ${
            caps.browserRunPath === 'off'
              ? 'disabled (needs --spec-root)'
              : 'files from the spec root'
          }] `;
    case 'browser_run_test':
    case 'session_run_test':
      return caps.testTools === 'off'
        ? '[disabled: host operator enables with --spec-root] '
        : caps.testTools === 'confined'
          ? '[confined: config and specs from the host spec root only] '
          : '';
    case 'scaffold_init':
      return caps.scaffoldInit ? '' : '[disabled: host operator enables with --allow-node-code] ';
    default:
      return '';
  }
};
