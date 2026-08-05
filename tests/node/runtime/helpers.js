import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { buildCandidates, populateCandidates, resolveChromium } from '../../../packages/runtime/resolve.js';

export const resolveTestBrowser = async () => {
  const candidates = buildCandidates({});
  const populated = await populateCandidates(candidates);
  const result = resolveChromium(populated);
  return result.found ? result.path : null;
};

export const launchHeadlessBrowser = async executablePath => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'szkrabok-test-browser-'));
  const proc = spawn(executablePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI',
    '--password-store=basic',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
  ], { stdio: 'ignore', detached: false });

  const cleanup = async () => {
    try { proc.kill('SIGKILL'); } catch { /* process already gone */ }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(userDataDir, { recursive: true, force: true });
        return;
      } catch (e) {
        if (e.code !== 'ENOTEMPTY') throw e;
        await new Promise(r => setTimeout(r, 200));
      }
    }
    await rm(userDataDir, { recursive: true, force: true });
  };

  return { proc, userDataDir, cleanup };
};
