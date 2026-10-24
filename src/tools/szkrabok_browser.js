import { getSession, EngineNotSupportedError } from '#runtime';
import { open as sessionOpen } from './szkrabok_session.js';
import { resolve, dirname, join } from 'path';
import { spawn } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import { access, readFile, mkdir, unlink } from 'fs/promises';
import { getFlags, getCapabilities } from '../flags.js';
import { confinePath } from '../utils/paths.js';
import { ValidationError } from '../utils/errors.js';
import { buildTestEnv, buildTestArgv, assertReportName } from './run_test_args.js';
import { assertReadable } from './nav_guard.js';

// Playwright binary for a run: the project's local install, never a registry
// fetch (E8).
const playwrightCommand = cwd => {
  const local = join(cwd, 'node_modules', '.bin', 'playwright');
  if (existsSync(local)) return { cmd: local, pre: [] };
  return { cmd: 'npx', pre: ['--no-install', 'playwright'] };
};

/**
 * Resolve config/files/report locations for one run.
 * confined (--spec-root): config and files only from the spec root; artifacts
 *   under <work-root>/reports/<session>/ (hardening proposal D3, D6).
 * unconfined (--allow-node-code): legacy behaviour, relative to the work root.
 */
const resolveRunPaths = ({ mode, sessionName, config, files, reportFile }) => {
  const { workRoot, specRoot } = getFlags();
  const reportsDir = join(workRoot, 'reports', sessionName);

  if (!Array.isArray(files)) throw new ValidationError('files must be an array', 'files');

  if (mode === 'confined') {
    return {
      configPath: confinePath(specRoot, config ?? 'playwright.config.js'),
      files: files.map(f => confinePath(specRoot, f)),
      cwd: specRoot,
      reportsDir,
      jsonFile: join(
        reportsDir,
        reportFile !== undefined ? assertReportName(reportFile) : 'last-run.json'
      ),
      outputDir: join(reportsDir, 'test-results'),
      updateSnapshots: 'none',
    };
  }

  const configPath = resolve(workRoot, config ?? 'playwright.config.js');
  return {
    configPath,
    files: files.map(f => resolve(workRoot, String(f))),
    cwd: dirname(configPath),
    reportsDir,
    jsonFile:
      reportFile !== undefined ? resolve(workRoot, reportFile) : join(reportsDir, 'last-run.json'),
    outputDir: undefined,
    updateSnapshots: undefined,
  };
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
          title: spec.title,
          status: result.status,
          error: result.error ? result.error.message : null,
          result:
            attachments.length === 1
              ? attachments[0]
              : attachments.length > 1
                ? attachments
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
    config,
    project,
    workers,
    signalAttach,
    files = [],
    keepOpen = false,
    reportFile,
  } = args;

  const mode = getCapabilities().testTools;
  if (mode === 'off') throw new Error('browser_run_test is disabled (needs --spec-root)');

  // All caller input is validated before any session lookup, mkdir or spawn.
  const paths = resolveRunPaths({ mode, sessionName, config, files, reportFile });
  const argsPW = buildTestArgv({
    configPath: paths.configPath,
    outputDir: paths.outputDir,
    updateSnapshots: paths.updateSnapshots,
    files: paths.files,
    project,
    workers,
    grep,
  });
  buildTestEnv({ baseEnv: {}, params }); // validate params before any lookup; real env below

  if (!existsSync(paths.configPath)) {
    return {
      error: `playwright.config.js not found at ${paths.configPath}`,
      hint:
        mode === 'confined'
          ? 'The host operator provides playwright.config.js in the spec root.'
          : 'Run scaffold_init to create the project scaffold.',
    };
  }

  let session;
  try {
    session = getSession(sessionName);
  } catch {
    throw new Error(`Session "${sessionName}" not open`);
  }

  if (session.browserEngine === 'firefox') {
    throw new EngineNotSupportedError(
      'browser_run_test',
      'firefox',
      'browser_run_test requires a CDP connection.'
    );
  }

  if (!session.cdpPort) {
    throw new Error(`Session "${sessionName}" missing CDP port — reopen session`);
  }

  const sessionDir = paths.reportsDir;
  await mkdir(sessionDir, { recursive: true });
  const jsonFile = paths.jsonFile;
  const logFile = join(sessionDir, 'last-run.log');

  // Optional: wait for CDP attach signal from the fixture before running tests.
  // Ensures the spawned worker has successfully connected to the browser before
  // the handler lock is released (used by session_run_test withLock).
  const attachSignalFile = signalAttach ? join(sessionDir, `.attach-signal`) : null;

  const env = buildTestEnv({
    baseEnv: process.env,
    params,
    fixed: {
      FORCE_COLOR: '0',
      SZKRABOK_SESSION: sessionName,
      PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
      SZKRABOK_CDP_ENDPOINT: `http://localhost:${session.cdpPort}`,
      ...(attachSignalFile && { SZKRABOK_ATTACH_SIGNAL: attachSignalFile }),
      ...(project && { PLAYWRIGHT_PROJECT: project }),
    },
  });

  const pw = playwrightCommand(paths.cwd);

  await new Promise((resolveP, rejectP) => {
    const logStream = createWriteStream(logFile);

    const child = spawn(pw.cmd, [...pw.pre, ...argsPW], {
      cwd: paths.cwd,
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
        error:
          'signalAttach: fixture did not write CDP attach signal — check log for startup errors',
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
      try {
        report = JSON.parse(reportRaw);
      } catch {
        report = null;
      }
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
    passed: stats.expected,
    failed: stats.unexpected,
    skipped: stats.skipped,
    tests: flattenTests(report),
    reportFile: jsonFile,
    ...(keepOpen && { sessionReconnected }),
  };
};

const selectExport = (mod, fn, label) => {
  const target = fn === 'default' ? mod.default : mod[fn];

  if (typeof target !== 'function') {
    const available = Object.keys(mod)
      .filter(k => typeof mod[k] === 'function')
      .join(', ');

    throw new Error(`Export "${fn}" not found in "${label}". Available: [${available}]`);
  }

  return target;
};

export const run_code = async args => {
  const { sessionName, code, fn = 'default', args: callArgs = {} } = args;

  const session = getSession(sessionName);
  const evaluated = eval(`(${code})`);
  const mod = typeof evaluated === 'function' ? { default: evaluated } : evaluated;
  const target = selectExport(mod, fn, 'inline code');

  const result = await target(session.page, callArgs);

  return {
    fn,
    result,
    url: session.page.url(),
  };
};

export const run_file = async args => {
  const { sessionName, path, fn = 'default', args: scriptArgs = {} } = args;

  const session = getSession(sessionName);
  const absolute = resolve(path);

  const mod = await import(`${absolute}?t=${Date.now()}`);
  const target = selectExport(mod, fn, absolute);

  const result = await target(session.page, scriptArgs);

  return {
    fn,
    result,
    url: session.page.url(),
  };
};

// Page-sandbox form (hardening proposal D2): the code runs inside the page via
// page.evaluate and has no access to Node or Playwright APIs.
const PAGE_MODE_HINT =
  'browser_run runs in the page sandbox: code must be a function expression (args) => result ' +
  'with a JSON-serializable result. The Node form (page, args) needs --allow-node-code';

export const run_page = async args => {
  const { sessionName, code, path, fn, args: callArgs = {} } = args;

  if (fn !== undefined) {
    throw new ValidationError(`"fn" is not supported in page mode. ${PAGE_MODE_HINT}`, 'fn');
  }

  let source;
  if (code !== undefined) {
    source = code;
  } else {
    const { specRoot } = getFlags();
    source = await readFile(confinePath(specRoot, path), 'utf8');
  }

  const session = getSession(sessionName);
  assertReadable(session.page);
  try {
    const result = await session.page.evaluate(`(${source})(${JSON.stringify(callArgs)})`);
    return { result, url: session.page.url() };
  } catch (err) {
    if (!err.code) err.code = 'PAGE_EVAL_FAILED';
    err.hint = PAGE_MODE_HINT;
    throw err;
  }
};

export const run = async args => {
  if (args.code === undefined && args.path === undefined) {
    throw new Error('browser_run requires either "code" or "path"');
  }
  if (getCapabilities().browserRunCode !== 'node') return run_page(args);
  if (args.code !== undefined) return run_code(args);
  return run_file(args);
};
