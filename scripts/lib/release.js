// Shared release primitives. One implementation behind release:publish,
// release:publish-gitonly, release:publish-both and release:github.
//
// The targets are orthogonal: npm publish (which runs the gate through the
// prepublishOnly lifecycle) and the GitHub release. A git-only release has no
// npm lifecycle to run the gate, so the orchestrator runs the same gate script
// explicitly. Keep release logic here; the scripts are thin callers.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const run = (cmd, opts = {}) =>
  execSync(cmd, { cwd: root, stdio: 'inherit', ...opts, env: { ...process.env, ...opts.env } });

export const fail = msg => {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
};

export const readPackage = () => JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const quiet = cmd => execSync(cmd, { cwd: root, stdio: 'pipe' }).toString().trim();

export const requireNpmAuth = () => {
  try {
    quiet('npm whoami');
  } catch {
    fail('not logged in to npm. Run: npm login');
  }
};

export const requireGhAuth = () => {
  // GH_TOKEN in env skips keyring entirely — preferred over gh auth login
  if (process.env.GH_TOKEN) return;
  try {
    quiet('gh auth status');
  } catch {
    console.error('ERROR: GitHub auth required. Either:');
    console.error('  GH_TOKEN=<token> npm run release:github');
    console.error('  gh auth login');
    process.exit(1);
  }
};

// The release commit must carry the tag for the version in package.json.
// atHead: the orchestrator runs on the release commit. The standalone
// release:github may run later from another commit, so it only checks that the
// tag exists (gh would otherwise create it at the default branch).
export const requireTag = (version, { atHead = true } = {}) => {
  const expected = `v${version}`;
  if (!atHead) {
    try {
      quiet(`git rev-parse --verify refs/tags/${expected}`);
    } catch {
      fail(`tag ${expected} not found. Run npm run release:patch|minor|major first.`);
    }
    return;
  }
  let tag;
  try {
    tag = quiet('git describe --exact-match --tags HEAD');
  } catch {
    fail('HEAD is not tagged. Run npm run release:patch, release:minor or release:major first.');
  }
  if (tag !== expected) {
    fail(`HEAD is tagged ${tag} but package.json says ${expected}. Bump and tag first.`);
  }
};

// Hand-written notes (docs/releases/<version>.md) win over generated ones.
const releaseNotes = version => {
  const notesFile = resolve(root, 'docs', 'releases', `${version}.md`);
  return { notesFile, exists: existsSync(notesFile) };
};

export const createGithubRelease = (version, { force = false } = {}) => {
  const tag = `v${version}`;
  const { notesFile, exists: hasNotes } = releaseNotes(version);
  const notes = hasNotes ? `--notes-file "${notesFile}"` : '--generate-notes';

  let exists = false;
  try {
    quiet(`gh release view "${tag}"`);
    exists = true;
  } catch {
    // absence is the expected path
  }

  if (!exists) {
    console.log(`Creating GitHub release ${tag}...`);
    run(`gh release create "${tag}" ${notes} --title "${tag}"`);
    console.log(`\nDone. https://github.com/PabloVitasso/szkrabok/releases/tag/${tag}`);
    return;
  }

  if (!force) {
    fail(
      `GitHub release ${tag} already exists. Re-run with --force to update its notes, ` +
        'or edit it on GitHub.'
    );
  }
  // gh release edit has no --generate-notes; updating needs a notes file.
  if (!hasNotes) {
    fail(
      `GitHub release ${tag} exists and there is no docs/releases/${version}.md to update from.`
    );
  }
  console.log(`Updating GitHub release ${tag}...`);
  run(`gh release edit "${tag}" --notes-file "${notesFile}" --title "${tag}"`);
  console.log(`\nDone. https://github.com/PabloVitasso/szkrabok/releases/tag/${tag}`);
};

export const TARGETS = ['npm', 'github', 'both'];

export const targetsOf = target => (target === 'both' ? ['npm', 'github'] : [target]);

// Pure argument parser (throws; the caller maps the message through fail()).
export const parseArgs = argv => {
  const out = { target: 'npm', skipGate: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-gate') out.skipGate = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--target') {
      const value = argv[++i];
      if (!value) throw new Error('--target needs a value: npm | github | both');
      out.target = value;
    } else if (arg.startsWith('--target=')) {
      out.target = arg.slice('--target='.length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!TARGETS.includes(out.target)) {
    throw new Error(`unknown --target "${out.target}". Use: ${TARGETS.join(' | ')}`);
  }
  return out;
};
