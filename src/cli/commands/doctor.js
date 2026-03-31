import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlaywrightCore } from '../../../scripts/resolve-playwright-core.js';
import { szkrabokCacheDir } from '../../utils/platform.js';
import {
  buildCandidates,
  populateCandidates,
  validateCandidate,
} from '#runtime';
import { initConfig, getConfig } from '../../config.js';

const pass = (label, detail = '') => {
  let detailStr;
  if (detail) {
    detailStr = ': ' + detail;
  } else {
    detailStr = '';
  }
  console.log(`  [pass] ${label}${detailStr}`);
};

const fail = (label, detail = '') => {
  let detailStr;
  if (detail) {
    detailStr = ': ' + detail;
  } else {
    detailStr = '';
  }
  console.error(`  [FAIL] ${label}${detailStr}`);
  return true; // signals failure
};

const warn = (label, detail = '') => {
  let detailStr;
  if (detail) {
    detailStr = ': ' + detail;
  } else {
    detailStr = '';
  }
  console.log(`  [warn] ${label}${detailStr}`);
};

// 'not set' = env/config not provided at all → [ABSENT]
// 'empty path' = CHROMIUM_PATH='' → invalid config → [FAIL  ]
const ABSENT_REASONS = new Set(['not set']);

// Static lookup: playwright-core version → expected Chromium major.
// Add one entry per playwright-core upgrade.
const PLAYWRIGHT_CHROMIUM_MAJOR = {
  '1.58.2': 133,
};

function getExpectedChromiumMajor(pwCoreVersion) {
  return PLAYWRIGHT_CHROMIUM_MAJOR[pwCoreVersion] ?? null;
}

function extractChromiumMajor(versionString) {
  // e.g. "Chromium 133.0.6943.16" or "Google Chrome 133.0.6943.16 ..."
  const m = versionString.match(/(\d+)\.\d+\.\d+\.\d+/);
  return m ? parseInt(m[1], 10) : null;
}

// Fixed-width status tags (8 chars each) for machine-parseable output.
const TAGS = {
  pass:    '[PASS  ]',
  fail:    '[FAIL  ]',
  skip:    '[SKIP  ]',
  absent:  '[ABSENT]',
  ignored: '[      ]',
};

function candidateState(i, winnerIdx, r) {
  if (i === winnerIdx) return 'pass';
  if (winnerIdx < 0 || i < winnerIdx) {
    return ABSENT_REASONS.has(r.reason) ? 'absent' : 'fail';
  }
  // i > winnerIdx — not part of the winning decision
  return r.ok ? 'skip' : 'ignored';
}

export function register(program) {
  program
    .command('doctor')
    .description('Check szkrabok environment and dependencies')
    .option('--strict', 'Exit 1 if any check fails (default: exit 0)')
    .action(async (opts) => {
      let failed = false;
      console.log('szkrabok doctor\n');

      // 1. Node version
      const [major] = process.versions.node.split('.').map(Number);
      if (major >= 20) pass('node version', process.versions.node);
      else failed = fail('node version', `${process.versions.node} (need >=20)`);

      // 2. playwright-core installed — hoisting-aware resolution
      const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
      const pwCorePath = resolvePlaywrightCore(pkgRoot);
      let pwCoreVersion = null;
      if (pwCorePath) {
        const { version } = JSON.parse(await fs.readFile(join(pwCorePath, 'package.json'), 'utf8'));
        pwCoreVersion = version;
        pass('playwright-core installed', version);

        // 3. playwright-core patched
        const crConnectionJs = join(pwCorePath, 'lib', 'server', 'chromium', 'crConnection.js');
        if (existsSync(crConnectionJs)) {
          const src = await fs.readFile(crConnectionJs, 'utf8');
          if (src.includes('__re__emitExecutionContext')) pass('playwright-core patched (stealth)');
          else warn('playwright-core not patched', 'run: node scripts/patch-playwright.js');
        } else {
          warn('playwright-core patch check skipped', 'crConnection.js not found');
        }
      } else {
        failed = fail('playwright-core installed', `not found near ${pkgRoot}`);
      }

      // 4. Browser resolution — full candidate chain
      console.log('\nBrowser resolution:');
      initConfig([]);
      let cfg;
      try { cfg = getConfig(); } catch { cfg = {}; }
      const candidates = buildCandidates({ executablePath: cfg.executablePath });
      await populateCandidates(candidates);

      // Evaluate all candidates for full diagnostics (not short-circuit)
      const results = candidates.map(c => ({
        source: c.source,
        path: c.path,
        ...validateCandidate(c.path),
      }));
      const winnerIdx = results.findIndex(r => r.ok);

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const state = candidateState(i, winnerIdx, r);
        const tag = TAGS[state];
        let detail;
        if (state === 'pass') {
          detail = r.path;
        } else if (state === 'ignored') {
          detail = '(not evaluated)';
        } else if (state === 'skip') {
          detail = `${r.path} — valid, lower priority`;
        } else {
          // fail or absent
          const pathStr = r.path ?? '(not set)';
          detail = `${pathStr} — ${r.reason}`;
        }
        console.log(`  ${tag} ${r.source.padEnd(12)} ${detail}`);
      }

      if (winnerIdx >= 0) {
        const winner = results[winnerIdx];
        console.log(`\n  Resolved: ${winner.source} — ${winner.path}`);

        // Best-effort version read — failure is not a doctor error
        const vResult = spawnSync(winner.path, ['--version'], {
          encoding: 'utf8',
          timeout: 3000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (vResult.status === 0 && vResult.stdout) {
          const version = vResult.stdout.trim().split('\n')[0];
          console.log(`  Version: ${version}`);
        }

        // CDP version check — only for non-playwright-managed binaries
        if (winner.source !== 'playwright') {
          const expectedMajor = getExpectedChromiumMajor(pwCoreVersion);
          const versionStr = vResult.status === 0 && vResult.stdout
            ? vResult.stdout.trim().split('\n')[0]
            : null;
          const actualMajor = versionStr ? extractChromiumMajor(versionStr) : null;

          if (expectedMajor !== null && actualMajor !== null) {
            if (expectedMajor !== actualMajor) {
              warn('CDP compatibility', `expected Chromium M${expectedMajor}, found M${actualMajor}`);
            }
            // exact match: no warning
          } else {
            const noteMsg = expectedMajor === null
              ? 'playwright version not in lookup table — skipping CDP compatibility check'
              : 'binary version unreadable';
            console.log(`  [note] CDP compatibility: ${noteMsg}`);
          }
        }
      } else {
        failed = true;
        console.error('\n  No valid browser found. Run: szkrabok install-browser');
      }

      // 5. MCP server imports
      try {
        await import('../../server.js');
        pass('server.js imports');
      } catch (err) {
        let errMessage;
        if (err !== null && err !== undefined && err.message !== null && err.message !== undefined) {
          errMessage = err.message;
        } else {
          errMessage = null;
        }
        failed = fail('server.js imports', errMessage);
      }

      // 6. Startup log
      const logFile = join(szkrabokCacheDir(), 'startup.log');
      if (existsSync(logFile)) pass('startup log exists', logFile);
      else pass('startup log', `will be created at ${logFile}`);

      // 7. Dev MCP config hint (only when running from source repo)
      // Note: Claude Code does NOT honor the `cwd` field in MCP server config.
      // Use `bash -c "cd <testNpxDir> && npx ..."` to force npx to resolve the
      // published package from test/npx (which has no local workspace) instead
      // of the repo root (where local bin is not linked, causing exit 127).
      const testNpxDir = join(pkgRoot, 'test', 'npx');
      if (existsSync(testNpxDir)) {
        console.log('\n--- Dev MCP config (for developing szkrabok itself) ---');
        let command, args;
        if (process.platform === 'win32') {
          command = 'cmd';
          args = ['/c', `cd /d "${testNpxDir}" && npx -y @pablovitasso/szkrabok`];
        } else {
          command = 'bash';
          args = ['-c', `cd ${testNpxDir} && npx -y @pablovitasso/szkrabok`];
        }
        console.log(JSON.stringify({
          szkrabok: {
            type: 'stdio',
            command,
            args,
            env: {},
          }
        }, null, 2));
      }

      console.log(`\n${failed ? 'Some checks failed.' : 'All checks passed.'}`);
      process.exit(opts.strict && failed ? 1 : 0);
    });
}
