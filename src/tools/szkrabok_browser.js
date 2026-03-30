import { getSession } from '#runtime';
import { open as sessionOpen } from './szkrabok_session.js';
import { resolve, dirname, join } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createWriteStream, existsSync } from 'fs';
import { access, readFile, mkdir, unlink } from 'fs/promises';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Wait for a signal file to appear on disk, simulating fixture CDP attach confirmation.
 * Used by session_run_test withLock to hold the lock until the browser worker has
 * successfully connected to the CDP endpoint.
 */
export const waitForAttach = signalFile => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error('signalAttach timeout: fixture did not confirm CDP attach'));
    }, 30_000);
    const interval = setInterval(() => {
      access(signalFile)
        .then(() => {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        })
        .catch(() => {
          /* not ready yet — keep polling */
        });
    }, 100);
  });
};

const decodeAttachment = att => {
  if (att.contentType !== 'application/json' || !att.body) return;
  try {
    return JSON.parse(Buffer.from(att.body, 'base64').toString());
  } catch {
    return;
  }
};

const flattenTests = report =>
  report.suites.flatMap(suite =>
    suite.specs.flatMap(spec =>
      spec.tests.map(t => {
        const result = t.results[0];
        const attachments = result.attachments
          .filter(a => a.name === 'result')
          .map(a => decodeAttachment(a))
          .filter(Boolean);

        return {
          title:  spec.title,
          status: result.status,
          error:  result.error ? result.error.message : null,
          result: attachments.length === 1 ? attachments[0]
                : attachments.length > 1   ? attachments
                : undefined,
        };
      })
    )
  );

export const run_test = async args => {
  const {
    sessionName,
    grep,
    params = {},
    config = 'playwright.config.js',
    project,
    workers,
    signalAttach,
    files = [],
    keepOpen = false,
    reportFile,
  } = args;

  const configPath = resolve(REPO_ROOT, config);

  if (!existsSync(configPath)) {
    return {
      error: `playwright.config.js not found at ${configPath}`,
      hint: 'Run scaffold_init to create the project scaffold.',
    };
  }

  const sessionDir = join(dirname(configPath), 'sessions', sessionName);
  await mkdir(sessionDir, { recursive: true });

  let jsonFile;
  if (reportFile) {
    jsonFile = resolve(REPO_ROOT, reportFile);
  } else {
    jsonFile = join(sessionDir, 'last-run.json');
  }

  let session;
  try {
    session = getSession(sessionName);
  } catch {
    throw new Error(`Session "${sessionName}" not open`);
  }

  if (!session.cdpPort) {
    throw new Error(`Session "${sessionName}" missing CDP port — reopen session`);
  }

  const env = {
    ...process.env,
    FORCE_COLOR: '0',
    SZKRABOK_SESSION: sessionName,
    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
    SZKRABOK_CDP_ENDPOINT: `http://localhost:${session.cdpPort}`,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k.toUpperCase(), String(v)])
    ),
  };

  const logFile = join(sessionDir, 'last-run.log');

  // Optional: wait for CDP attach signal from the fixture before running tests.
  // Ensures the spawned worker has successfully connected to the browser before
  // the handler lock is released (used by session_run_test withLock).
  const attachSignalFile = signalAttach ? join(sessionDir, `.attach-signal`) : null;
  if (attachSignalFile) {
    env.SZKRABOK_ATTACH_SIGNAL = attachSignalFile;
  }

  const argsPW = [
    'playwright',
    'test',
    '--config',
    configPath,
    '--reporter',
    'list,json',
    '--timeout',
    '60000',
    ...(project ? ['--project', project] : []),
    ...(workers !== undefined ? ['--workers', String(workers)] : []),
  ];

  if (project) {
    env.PLAYWRIGHT_PROJECT = project;
  }
  if (grep) {
    argsPW.push('--grep', grep);
  }
  if (files.length) {
    argsPW.push(...files);
  }

  await new Promise((resolveP, rejectP) => {
    const logStream = createWriteStream(logFile);

    const child = spawn('npx', argsPW, {
      cwd: dirname(configPath),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });

    child.once('error', rejectP);

    child.once('close', () => {
      logStream.end();
      logStream.once('finish', resolveP);
    });
  });

  // The fixture writes the attach-signal file at worker teardown, before the subprocess exits.
  // By the time the close event fires the file must already be on disk.
  // If it is absent immediately after process exit the fixture never ran teardown (e.g. the
  // subprocess crashed during ESM load). Fail fast with the actual log rather than letting
  // waitForAttach spin for 30 s and surface a misleading timeout error.
  if (attachSignalFile) {
    if (!existsSync(attachSignalFile)) {
      const logRaw = await readFile(logFile, 'utf8').catch(() => '');
      const log = logRaw.split('\n').filter(Boolean);
      return {
        exitCode: 1,
        log,
        error: 'signalAttach: fixture did not write CDP attach signal — check log for startup errors',
      };
    }
    await waitForAttach(attachSignalFile);
  }

  const [logRaw, reportRaw] = await Promise.all([
    readFile(logFile, 'utf8').catch(() => ''),
    readFile(jsonFile, 'utf8').catch(() => null),
  ]);

  if (attachSignalFile) {
    await unlink(attachSignalFile).catch(() => {});
  }

  const log = logRaw.split('\n').filter(Boolean);

  let report;
  try {
    if (reportRaw) {
      try { report = JSON.parse(reportRaw); } catch { report = null; }
    } else {
      report = null;
    }
  } catch {
    report = null;
  }

  let sessionReconnected = false;

  if (keepOpen) {
    try {
      getSession(sessionName);
    } catch {
      await sessionOpen({ sessionName });
      sessionReconnected = true;
    }
  }

  if (!report) {
    return {
      exitCode: 1,
      log,
      error: 'JSON report missing or invalid',
      sessionReconnected,
    };
  }

  const { stats } = report;

  return {
    log,
    passed:  stats.expected,
    failed:  stats.unexpected,
    skipped: stats.skipped,
    tests: flattenTests(report),
    reportFile: jsonFile,
    ...(keepOpen && { sessionReconnected }),
  };
};

export const run_code = async args => {
  const { sessionName, code } = args;

  const session = getSession(sessionName);
  const fn = eval(`(${code})`);

  const result = await fn(session.page);

  return {
    result,
    url: session.page.url(),
  };
};

export const run_file = async args => {
  const { sessionName, path, fn = 'default', args: scriptArgs = {} } = args;

  const session = getSession(sessionName);
  const absolute = resolve(path);

  const mod = await import(`${absolute}?t=${Date.now()}`);
  let target;
  if (fn === 'default') {
    target = mod.default;
  } else {
    target = mod[fn];
  }

  if (typeof target !== 'function') {
    const available = Object.keys(mod)
      .filter(k => typeof mod[k] === 'function')
      .join(', ');

    throw new Error(
      `Export "${fn}" not found in "${absolute}". Available: [${available}]`
    );
  }

  const result = await target(session.page, scriptArgs);

  return {
    fn,
    result,
    url: session.page.url(),
  };
};

export const run = async args => {
  if (args.code !== undefined) return run_code(args);
  if (args.path !== undefined) return run_file(args);
  throw new Error('browser_run requires either "code" or "path"');
};
