import { mkdtemp, rm, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn, spawnSync } from 'child_process';
import {
  buildCandidates,
  populateCandidates,
  resolveChromium,
} from '../../../packages/runtime/resolve.js';

// Leak audit (2026-10-31, claude-docker 20261031-szkrabok-test-browser-leak.md):
// the resolved browser can be a wrapper (flatpak/snap/shim). proc.kill()
// then kills the wrapper only — bwrap and the chrome tree reparent and run
// forever. cleanup() therefore kills the whole tree: the process group on
// POSIX, taskkill /T on Windows, plus a belt that kills by profile dir for
// any wrapper that escapes the group. Two assertions back it (A1): one on
// this run's dirs, one age-based sweep for crash orphans of earlier runs.

const spawnedDirs = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const listDirPids = dir => {
  // PIDs whose command line names this profile dir. POSIX: ps. Windows:
  // tasklist shows no command lines (A3) — wmic does.
  const out =
    process.platform === 'win32'
      ? spawnSync('wmic', ['process', 'get', 'ProcessId,CommandLine'], {
          encoding: 'utf8',
          windowsHide: true,
        })
      : spawnSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
  const needle = `--user-data-dir=${dir}`;
  const pids = [];
  for (const line of (out.stdout || '').split('\n')) {
    if (!line.includes(needle)) continue;
    const pid = parseInt(line.trim().split(/\s+/)[0], 10);
    if (Number.isInteger(pid) && pid !== process.pid) pids.push(pid);
  }
  return pids;
};

// A7: the belt runs in a small retry loop — zygote respawn races a
// single pass.
const beltKill = async dir => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const pids = listDirPids(dir);
    if (pids.length === 0) return;
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    await sleep(200);
  }
};

const killTree = proc => {
  if (process.platform === 'win32') {
    // A3: no process groups in Node on Windows — the tree goes via
    // taskkill /T.
    try {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
      });
    } catch {
      /* already gone */
    }
  } else {
    // A8: detached:true gave the child a fresh, private process
    // group — the group kill cannot hit the runner itself.
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  try {
    proc.kill('SIGKILL');
  } catch {
    /* already gone */
  }
};

export const resolveTestBrowser = async () => {
  const candidates = buildCandidates({});
  const populated = await populateCandidates(candidates);
  const result = resolveChromium(populated);
  return result.found ? result.path : null;
};

export const launchHeadlessBrowser = async executablePath => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'szkrabok-test-browser-'));
  spawnedDirs.add(userDataDir);
  const proc = spawn(
    executablePath,
    [
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
    ],
    // A2: detached (POSIX) puts the tree in its own process group so
    // cleanup can kill it whole. Trade-off, named: a crashed runner
    // no longer signals the browsers — the stale sweep catches them.
    { stdio: 'ignore', detached: process.platform !== 'win32' }
  );

  const cleanup = async () => {
    killTree(proc);
    await beltKill(userDataDir);
    // A4: the rm is best-effort — a throw here would mask the real
    // test error in the caller's finally. The dir must also STAY
    // gone: a racing browser recreates it after the rm.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(userDataDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      await sleep(200);
      try {
        await stat(userDataDir);
      } catch {
        return; // gone and not recreated
      }
      await beltKill(userDataDir);
    }
    console.warn(`[helpers] profile dir survived cleanup: ${userDataDir}`);
  };

  return { proc, userDataDir, cleanup };
};

// A1, check 1: this run's own dirs. Precise under concurrent runs —
// it can only see leaks from the launches this run made.
export const assertNoBrowserLeaks = async () => {
  await sleep(500);
  const survivors = [];
  for (const dir of spawnedDirs) {
    const pids = listDirPids(dir);
    if (pids.length > 0) survivors.push(`${dir} (${pids.join(', ')})`);
  }
  if (survivors.length > 0) {
    throw new Error(
      `leaked test browsers from this run:\n  ${survivors.join('\n  ')}`
    );
  }
};

// A1, check 2: the age-based stale sweep. Crash orphans from earlier
// runs are killed and named — they belong to no run's assertNoBrowserLeaks.
// Portable ages: ps etimes on POSIX, wmic CreationDate on Windows (A3).
const listStalePids = maxAgeMs => {
  const now = Date.now();
  const pids = [];
  if (process.platform === 'win32') {
    const out = spawnSync('wmic', ['process', 'get', 'ProcessId,CreationDate,CommandLine'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    for (const line of (out.stdout || '').split('\n')) {
      if (!line.includes('szkrabok-test-browser-')) continue;
      const m = line.match(/(\d{14})\.\d{6}[+-]\d{3}/); // YYYYMMDDHHMMSS.mmmmmm+UUU
      const pid = parseInt(line.trim().split(/\s+/)[0], 10);
      if (!m || !Number.isInteger(pid) || pid === process.pid) continue;
      const created = Date.parse(
        `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[1].slice(8, 10)}:${m[1].slice(10, 12)}:${m[1].slice(12, 14)}Z`
      );
      if (now - created >= maxAgeMs) pids.push(pid);
    }
    return pids;
  }
  const out = spawnSync('ps', ['-eo', 'pid,etimes,args'], { encoding: 'utf8' });
  for (const line of (out.stdout || '').split('\n')) {
    if (!line.includes('szkrabok-test-browser-')) continue;
    const pid = parseInt(line.trim().split(/\s+/)[0], 10);
    const etimes = parseInt(line.trim().split(/\s+/)[1], 10);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    if (Number.isInteger(etimes) && etimes * 1000 >= maxAgeMs) pids.push(pid);
  }
  return pids;
};

export const sweepStaleBrowsers = async (maxAgeMs = 15 * 60_000) => {
  for (const pid of listStalePids(maxAgeMs)) {
    console.warn(`[helpers] stale test browser killed: pid ${pid}`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
};
