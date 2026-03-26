import { getSession } from '#runtime';
import { open as sessionOpen } from './szkrabok_session.js';
import { resolve, dirname, join } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';
import { createWriteStream, existsSync, writeFileSync, unlinkSync } from 'fs';
import { access, readFile, mkdir, unlink } from 'fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const _require = createRequire(import.meta.url);
let _runtimeEntry;   // undefined = not tried, null = not resolvable, string = path
let _shimPath;       // undefined = not created, null = not possible, string = path

export const getRuntimeEntry = () => {
  if (_runtimeEntry === undefined) {
    try {
      _runtimeEntry = _require.resolve('@pablovitasso/szkrabok/runtime');
    } catch {
      _runtimeEntry = null; // not resolvable — skip shim silently
    }
  }
  return _runtimeEntry;
};

export const writeRuntimeShim = () => {
  // Return cached shim if still on disk.
  if (_shimPath !== undefined) {
    if (_shimPath === null) return null;
    if (existsSync(_shimPath)) return _shimPath;
  }

  const entry = getRuntimeEntry();
  if (!entry) { _shimPath = null; return null; }

  const p = join(tmpdir(), `szkrabok-runtime-${randomUUID()}.mjs`);
  // globalThis guard prevents double-init if --import fires multiple times
  // (e.g. nested NODE_OPTIONS stacking or multiple workers sharing the flag).
  writeFileSync(p, [
    `import * as m from ${JSON.stringify(entry)};`,
    `globalThis.__szkrabok_runtime__ ??= m;`,
    `export * from ${JSON.stringify(entry)};`,
  ].join('\n') + '\n');

  _shimPath = p;

  const cleanup = () => { try { unlinkSync(p); } catch {} };
  process.once('beforeExit', cleanup);
  process.once('SIGINT',     cleanup);
  process.once('SIGTERM',    cleanup);

  return p;
};

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
  if (att === null || att === undefined) return;
  if (att.contentType !== 'application/json' || !att.body) return;
  try {
    return JSON.parse(Buffer.from(att.body, 'base64').toString());
  } catch {
    return;
  }
};

const flattenTests = report => {
  if (report === null || report === undefined) {
    return [];
  }

  const suites = report.suites !== null && report.suites !== undefined ? report.suites : [];

  return suites
    .filter(s => s !== null && s !== undefined)
    .flatMap(suite => {
      const specs = suite.specs !== null && suite.specs !== undefined ? suite.specs : [];
      return specs
        .filter(s => s !== null && s !== undefined)
        .flatMap(spec => {
          const tests = spec.tests !== null && spec.tests !== undefined ? spec.tests : [];
          return tests
            .filter(t => t !== null && t !== undefined)
            .map(t => {
              const result = t.results !== null && t.results !== undefined && t.results.length > 0
                ? t.results[0]
                : {};

              const resultAttachments = result.attachments !== null && result.attachments !== undefined
                ? result.attachments
                : [];

              const attachments = resultAttachments
                .filter(a => a !== null && a !== undefined && a.name === 'result')
                .map(a => decodeAttachment(a))
                .filter(decoded => decoded !== null && decoded !== undefined);

              let status;
              if (result.status !== null && result.status !== undefined) {
                status = result.status;
              } else {
                status = 'unknown';
              }

              let error;
              if (result.error !== null && result.error !== undefined) {
                if (result.error.message !== null && result.error.message !== undefined) {
                  error = result.error.message;
                } else {
                  error = null;
                }
              } else {
                error = null;
              }

              const testResult = attachments.length === 1
                ? attachments[0]
                : attachments.length > 1
                  ? attachments
                  : undefined;

              return {
                title: spec.title,
                status,
                error,
                result: testResult,
              };
            });
        });
    });
};

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

  const shimPath = writeRuntimeShim();

  const env = {
    ...process.env,
    FORCE_COLOR: '0',
    SZKRABOK_SESSION: sessionName,
    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, shimPath && `--import=${shimPath}`].filter(Boolean).join(' '),
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
      cwd: REPO_ROOT,
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

  // The e2e fixture writes the attach-signal file during worker teardown, just before the
  // subprocess exits. By the time the close event fires the file is already on disk.
  if (attachSignalFile) await waitForAttach(attachSignalFile);

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

  let passed, failed, skipped;
  if (stats !== null && stats !== undefined) {
    if (stats.expected !== null && stats.expected !== undefined) {
      passed = stats.expected;
    } else {
      passed = 0;
    }
    if (stats.unexpected !== null && stats.unexpected !== undefined) {
      failed = stats.unexpected;
    } else {
      failed = 0;
    }
    if (stats.skipped !== null && stats.skipped !== undefined) {
      skipped = stats.skipped;
    } else {
      skipped = 0;
    }
  } else {
    passed = 0;
    failed = 0;
    skipped = 0;
  }

  return {
    log,
    passed,
    failed,
    skipped,
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
