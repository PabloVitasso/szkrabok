import { getSession } from '#runtime';
import { open as sessionOpen } from './szkrabok_session.js';
import { resolve, dirname, join } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createWriteStream, existsSync } from 'fs';
import { readFile, mkdir } from 'fs/promises';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
    files = [],
    keepOpen = false,
  } = args;

  const configPath = resolve(REPO_ROOT, config);

  if (!existsSync(configPath)) {
    return {
      error: `playwright.config.js not found at ${configPath}`,
      hint: 'Run scaffold.init to create the project scaffold.',
    };
  }

  const env = {
    ...process.env,
    FORCE_COLOR: '0',
    SZKRABOK_SESSION: sessionName,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k.toUpperCase(), String(v)])
    ),
  };

  let session;
  try {
    session = getSession(sessionName);
  } catch {
    throw new Error(`Session "${sessionName}" not open`);
  }

  if (!session.cdpPort) {
    throw new Error(`Session "${sessionName}" missing CDP port — reopen session`);
  }

  env.SZKRABOK_CDP_ENDPOINT = `http://localhost:${session.cdpPort}`;

  const sessionDir = join(dirname(configPath), 'sessions', sessionName);
  await mkdir(sessionDir, { recursive: true });

  const logFile = join(sessionDir, 'last-run.log');
  const jsonFile = join(sessionDir, 'last-run.json');

  const argsPW = [
    'playwright',
    'test',
    '--config',
    configPath,
    '--timeout',
    '60000',
    ...(project ? ['--project', project] : []),
  ];

  if (project) env.PLAYWRIGHT_PROJECT = project;
  if (grep) argsPW.push('--grep', grep);
  if (files.length) argsPW.push(...files);

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

  const [logRaw, reportRaw] = await Promise.all([
    readFile(logFile, 'utf8').catch(() => ''),
    readFile(jsonFile, 'utf8').catch(() => null),
  ]);

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
