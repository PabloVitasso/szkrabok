import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlaywrightCore } from '../../../scripts/resolve-playwright-core.js';
import { findChromium } from '../../../scripts/find-chromium.js';
import { szkrabokCacheDir } from '../../utils/platform.js';

const pass = (label, detail = '') =>
  console.log(`  [pass] ${label}${detail ? ': ' + detail : ''}`);

const fail = (label, detail = '') => {
  console.error(`  [FAIL] ${label}${detail ? ': ' + detail : ''}`);
  return true; // signals failure
};

const warn = (label, detail = '') =>
  console.log(`  [warn] ${label}${detail ? ': ' + detail : ''}`);

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
        failed = fail('server.js imports', err?.message);
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
        const [command, ...args] = process.platform === 'win32'
          ? ['cmd', '/c', `cd /d "${testNpxDir}" && npx -y @pablovitasso/szkrabok`]
          : ['bash', '-c', `cd ${testNpxDir} && npx -y @pablovitasso/szkrabok`];
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
      process.exit(failed ? 1 : 0);
    });
}
