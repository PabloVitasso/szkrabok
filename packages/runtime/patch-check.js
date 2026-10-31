// patch-check.js — is the stealth-patched playwright-core actually installed?
//
// Two independent patches, both checked here:
//   rebrowser patches   scripts/apply-patches.js (patch-package, patches/*.patch);
//                       to be replaced by a rebrowser drop-in core
//   greasy brands       scripts/apply-greasy-brands.js (greasy-brands-patch.js);
//                       szkrabok's own, applied to whichever core is installed
// When install scripts are skipped (npm --ignore-scripts, pnpm 10 unapproved
// builds, Bun untrusted deps) both are silently absent. One marker list for the
// postinstall verifier, `szkrabok doctor`, launch() and the tests.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { GREASY_BRANDS_MARKER } from './greasy-brands-patch.js';

// Since playwright-core 1.60.0 all server source is bundled into coreBundle.js.
export const PATCH_FILE = 'lib/coreBundle.js';

export const REBROWSER_PATCH_MARKERS = Object.freeze([
  '__re__emitExecutionContext',
  'getExecutionContext',
  'var __pwUs = class',
  'REBROWSER_PATCHES_RUNTIME_FIX_MODE',
]);

export const PATCH_MARKERS = Object.freeze([...REBROWSER_PATCH_MARKERS, GREASY_BRANDS_MARKER]);

export const PATCH_HINT =
  'reinstall @pablovitasso/szkrabok with install scripts enabled ' +
  '(npm: no --ignore-scripts; pnpm: approve its build; bun: add it to trustedDependencies)';

/** Markers absent from <pwRoot>/lib/coreBundle.js, or null when the file cannot be read. */
export const missingPatchMarkers = pwRoot => {
  let src;
  try {
    src = readFileSync(join(pwRoot, PATCH_FILE), 'utf8');
  } catch {
    return null;
  }
  return PATCH_MARKERS.filter(marker => !src.includes(marker));
};

/** The playwright-core that `playwright` (imported by launch.js) loads, or null. */
export const playwrightCoreRoot = () => {
  try {
    const fromRuntime = createRequire(import.meta.url);
    const fromPlaywright = createRequire(fromRuntime.resolve('playwright/package.json'));
    return dirname(fromPlaywright.resolve('playwright-core/package.json'));
  } catch {
    return null;
  }
};

/** Why the patch is not in place under pwRoot, or null when it is. */
export const patchProblem = pwRoot => {
  if (pwRoot === null) return 'playwright-core not found';
  const missing = missingPatchMarkers(pwRoot);
  if (missing === null) return `${PATCH_FILE} not readable in ${pwRoot}`;
  if (missing.length === 0) return null;
  return `${missing.length}/${PATCH_MARKERS.length} stealth patch markers missing in ${join(pwRoot, PATCH_FILE)} (${missing.join(', ')})`;
};
