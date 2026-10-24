import { ValidationError } from './errors.js';

// Session-name rule (hardening proposal D5). First char alphanumeric rejects
// ".", ".." and "-flag"; no path separators, no globs.
const SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// template: user-chosen names. any: ids coming back from the server — clone
// ids are <template>-<13-digit ms>-<8 hex>, 23 chars longer than the template.
const MAX_LEN = { template: 64, any: 96 };

export const assertSessionName = (name, { kind = 'template' } = {}) => {
  const max = MAX_LEN[kind];
  if (max === undefined) throw new Error(`assertSessionName: unknown kind "${kind}"`);

  if (typeof name !== 'string' || !SESSION_NAME.test(name) || name.length > max) {
    throw new ValidationError(
      `invalid sessionName ${JSON.stringify(name)}: must match ${SESSION_NAME} and be at most ${max} chars`,
      'sessionName'
    );
  }
  return name;
};
