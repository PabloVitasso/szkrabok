import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlaywrightCore } from '../../../scripts/resolve-playwright-core.js';
import { findChromium } from '../../../scripts/find-chromium.js';
import { szkrabokCacheDir } from '../../utils/platform.js';

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

export function register(program) {
  program
    .command('doctor')
    .description('Check szkrabok environment and dependencies')
    .action(async () => {
      let failed = false;
      console.log('szkrabok doctor\n');

      // 1. Node version
      const [major] = process.versions.node.split('.').map(Number);
      if (major >= 20) pass('node version', process.versions.node);
      else failed = fail('node version', `${process.versions.node} (need >=20)`);

      // 2. playwright-core installed — hoisting-aware resolution
      const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
      const pwCorePath = resolvePlaywrightCore(pkgRoot);
      if (pwCorePath) {
        const { version } = JSON.parse(await fs.readFile(join(pwCorePath, 'package.json'), 'utf8'));
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

      // 4. Chromium available (cross-platform: playwright-managed then system Chrome)
      const chromiumFound = await findChromium();
      if (chromiumFound) pass('chromium', chromiumFound);
      else failed = fail('chromium not found', 'run: szkrabok install-browser');

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

      console.log(`\n${(() => { if (failed) return 'Some checks failed.'; return 'All checks passed.'; })()}`);
      if (failed) { process.exit(1); } else { process.exit(0); }
    });
}
