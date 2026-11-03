#!/usr/bin/env node
// Release orchestrator. Targets are orthogonal; both share the gate and the
// tag check from lib/release.js.
//
//   --target npm      publish to npm (default). npm runs the gate itself
//                     through prepublishOnly, so nothing is duplicated here.
//   --target github   GitHub release only. No npm lifecycle runs the gate, so
//                     this script runs `npm run release:gate` first.
//   --target both     npm publish, then the GitHub release.
//   --skip-gate       skip the explicit gate for a GitHub-only release
//   --force           update an existing GitHub release's notes instead of failing
import {
  createGithubRelease,
  fail,
  parseArgs,
  readPackage,
  requireGhAuth,
  requireNpmAuth,
  requireTag,
  run,
  targetsOf,
} from './lib/release.js';

const opts = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (e) {
    return fail(e.message);
  }
})();

const { name, version } = readPackage();
const targets = targetsOf(opts.target);

requireTag(version);

// Check every required auth before the first mutating action, so a missing
// GitHub auth cannot surface after a successful npm publish.
if (targets.includes('npm')) requireNpmAuth();
if (targets.includes('github')) requireGhAuth();

if (targets.includes('npm')) {
  console.log(`Publishing ${name}@${version} to npm...`);
  run('npm publish --access public');
  console.log(`\nDone. https://www.npmjs.com/package/${name}`);
} else if (!opts.skipGate) {
  console.log('Running the release gate (lint + packed-tarball smoke test)...');
  run('npm run release:gate');
}

if (targets.includes('github')) createGithubRelease(version, { force: opts.force });
