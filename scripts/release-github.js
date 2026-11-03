#!/usr/bin/env node
// Standalone GitHub release for the current version: no gate, no npm.
// Prefer `npm run release:publish-gitonly` for a gated git-only release; this
// stays independent so it can run any time after a release, as documented.
import { createGithubRelease, readPackage, requireGhAuth, requireTag } from './lib/release.js';

const { version } = readPackage();
requireTag(version, { atHead: false });
requireGhAuth();
createGithubRelease(version, { force: process.argv.includes('--force') });
