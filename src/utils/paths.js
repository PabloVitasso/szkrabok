import { realpathSync } from 'node:fs';
import { resolve, dirname, basename, join, sep } from 'node:path';

// Path confinement for every tool-supplied path (hardening proposal D3).
// The container is hostile; roots are host-controlled and realpath'd here.

export class PathNotAllowedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathNotAllowedError';
    this.code = 'PATH_NOT_ALLOWED';
  }
}

const isInside = (root, p) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

const real = p => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/**
 * Resolve `input` against `root` and require the real path to stay inside it.
 * Returns the realpath'd absolute path. Callers must use the return value,
 * never the raw input.
 *
 * mustExist:false allows a missing final component (write target); its parent
 * must exist and resolve inside root.
 */
export const confinePath = (root, input, { mustExist = true } = {}) => {
  const deny = why => {
    throw new PathNotAllowedError(
      `path ${JSON.stringify(input)} not allowed: ${why} (root: ${root})`
    );
  };

  if (typeof input !== 'string' || input === '') deny('must be a non-empty string');
  if (input.includes('\0')) deny('contains NUL');
  if (input.startsWith('-')) deny('must not start with "-"');

  const realRoot = real(root);
  if (!realRoot) deny('root does not exist');

  const target = resolve(realRoot, input);
  let resolved = real(target);

  if (!resolved) {
    if (mustExist) deny('does not exist');
    const parent = real(dirname(target));
    if (!parent) deny('parent directory does not exist');
    resolved = join(parent, basename(target));
  }

  if (!isInside(realRoot, resolved)) deny('outside root');
  return resolved;
};

/** True when a and b (already realpath'd) are equal or one contains the other. */
export const overlaps = (a, b) => isInside(a, b) || isInside(b, a);
