import { getSession } from '@szkrabok/runtime';
import { open as sessionOpen } from './szkrabok_session.js';
import { resolve, dirname, join } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createWriteStream, existsSync } from 'fs';
import { readFile, mkdir } from 'fs/promises';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const decodeAttachment = att => {
  if (att?.contentType !== 'application/json' || !att.body) return;
  try {
    return JSON.parse(Buffer.from(att.body, 'base64').toString());
  } catch {
    return;
  }
};

const flattenTests = report => {
  const out = [];
  const suites = report?.suites || [];

  for (const suite of suites) {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const result = t.results?.[0] || {};
        const attachments = [];

        for (const a of result.attachments || []) {
          if (a.name !== 'result') continue;
          const decoded = decodeAttachment(a);
          if (decoded) attachments.push(decoded);
        }

        out.push({
          title: spec.title,
          status: result.status || 'unknown',
          error: result.error?.message || null,
          result:
            attachments.length === 1
              ? attachments[0]
              : attachments.length > 1
              ? attachments
              : undefined,
        });
      }
    }
  }

  return out;
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
      Object.entries(params).map(([k, v]) => [`TEST_${k.toUpperCase()}`, String(v)])
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

  const sessionDir = join(REPO_ROOT, 'sessions', sessionName);
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
  ];

  if (project) argsPW.push('--project', project);
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
    report = reportRaw ? JSON.parse(reportRaw) : null;
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
    passed: stats?.expected || 0,
    failed: stats?.unexpected || 0,
    skipped: stats?.skipped || 0,
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
  const target = fn === 'default' ? mod.default : mod[fn];

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
