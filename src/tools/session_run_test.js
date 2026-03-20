// session_run_test — composite session lifecycle + test run with deterministic invariants.
// Coordinates: session open → navigation readiness → test run → post-policy.
// Does not duplicate session or runner logic.

import { open as sessionOpen, close as sessionClose } from './szkrabok_session.js';
import { run_test } from './szkrabok_browser.js';
import { getSession, computeConfigHash, cloneFromLive } from '#runtime';

// ── Per-name critical section ──────────────────────────────────────────────────

const locks = new Map();

/**
 * Executes `fn` under a per-name lock.
 *
 * Concurrent calls with the same `name` serialize: the second waits for the first
 * to fully complete (including any async cleanup) before acquiring the gate.
 * Calls with different names run in parallel.
 */
const withLock = (name, fn) => {
  const prev = locks.get(name) ?? Promise.resolve();
  let release;
  const gate = new Promise(r => (release = r));
  locks.set(name, gate);
  return prev.then(fn).then(
    result => { release(); if (locks.get(name) === gate) locks.delete(name); return result; },
    err    => { release(); if (locks.get(name) === gate) locks.delete(name); throw err; }
  );
};

// ── Tool ───────────────────────────────────────────────────────────────────────

/**
 * Public tool entrypoint. Calls _run with real dependencies.
 */
export const session_run_test = args =>
  withLock(args.session.name, () =>
    _run(args, {
      sessionOpen,
      sessionClose,
      run_test,
      getSession,
      computeConfigHash,
      cloneFromLive,
    })
  );

/**
 * Core orchestration. Accepts deps object for testability (no module-level mocks needed).
 *
 * @param {object} args - tool arguments { session, test, postPolicy }
 * @param {object} deps - injectable test doubles
 * @param {Function} deps.sessionOpen      - opens a session
 * @param {Function} deps.sessionClose     - closes a session
 * @param {Function} deps.run_test         - runs playwright specs
 * @param {Function} deps.getSession      - gets a pool entry
 * @param {Function} deps.computeConfigHash - computes config hash
 * @param {Function} deps.cloneFromLive    - clones a live template
 */
export const _run = async (args, deps) => {
  const {
    sessionOpen:   _sessionOpen   = sessionOpen,
    sessionClose:   _sessionClose  = sessionClose,
    run_test:       _run_test     = run_test,
    getSession:     _getSession    = getSession,
    computeConfigHash: _computeConfigHash = computeConfigHash,
    cloneFromLive:  _cloneFromLive = cloneFromLive,
  } = deps;

  const { session, test, postPolicy = {} } = args;
  const logicalName = session.name;
  const mode        = session.mode ?? 'clone';
  const nav         = session.navigation ?? { policy: 'never' };

  // ── 1. Validation ───────────────────────────────────────────────────────────
  if (nav.policy !== 'never' && !nav.url) {
    return { error: 'navigation.url required when policy !== "never"', phase: 'session' };
  }

  // ── 2. Session resolution ───────────────────────────────────────────────────
  let runtimeName;

  try {
    if (mode === 'clone') {
      let templateOpen = false;
      try { _getSession(logicalName); templateOpen = true; } catch { /* not open */ }

      if (templateOpen) {
        const conflict = session.templateConflict ?? 'fail';
        if (conflict === 'close-first') {
          await _sessionClose({ sessionName: logicalName });
        } else if (conflict === 'clone-from-live') {
          runtimeName = (await _cloneFromLive(logicalName)).cloneId;
        } else {
          throw new Error(
            `Template "${logicalName}" is open — close it or set template.templateConflict`
          );
        }
      }

      if (!runtimeName) {
        const r = await _sessionOpen({
          sessionName:   logicalName,
          launchOptions: { ...session.launchOptions, isClone: true },
        });
        runtimeName = r.sessionName;
      }

    } else {
      // template mode
      let alreadyOpen = false;
      try { _getSession(logicalName); alreadyOpen = true; } catch { /* not open */ }

      if (alreadyOpen && session.launchOptions) {
        const poolEntry   = _getSession(logicalName);
        const storedHash  = poolEntry.configHash;
        const callerHash  = _computeConfigHash(session.launchOptions) ?? null;
        const mismatch    = storedHash !== callerHash;

        if (mismatch) {
          if (session.enforceLaunchOptionsMatch) {
            throw new Error(
              `launchOptions mismatch for session "${logicalName}". ` +
              `Stored config hash: ${storedHash ?? '(none)'}, caller hash: ${callerHash ?? '(none)'}`
            );
          }
          console.warn(
            `[session_run_test] launchOptions mismatch for session "${logicalName}" — ` +
            `stored: ${storedHash ?? '(none)'}, caller: ${callerHash ?? '(none)'}`
          );
        }
      }

      await _sessionOpen({ sessionName: logicalName, launchOptions: session.launchOptions });
      runtimeName = logicalName;
    }
  } catch (e) {
    return { error: e.message, phase: 'session' };
  }

  // ── 3. Navigation barrier ──────────────────────────────────────────────────
  try {
    if (nav.policy !== 'never') {
      const s = _getSession(runtimeName);
      const shouldNav =
        nav.policy === 'always' ||
        (nav.policy === 'ifBlank' && s.page.url() === 'about:blank');

      if (shouldNav) {
        await s.page.goto(nav.url, {
          waitUntil: 'networkidle',
          timeout:   nav.timeout ?? 30_000,
        });
      }
    }
  } catch (e) {
    return { error: e.message, phase: 'session' };
  }

  // ── 4. Test run (lock held through CDP attach via signalAttach) ─────────────
  let testResult;
  try {
    testResult = await _run_test({
      sessionName:  runtimeName,
      files:        Array.isArray(test.spec) ? test.spec : test.spec ? [test.spec] : [],
      grep:         test.grep,
      params:       test.params,
      config:       test.config,
      project:      test.project,
      workers:      1,
      reportFile:   test.reportFile,
      keepOpen:     false,
      signalAttach: true,
    });
  } catch (e) {
    // Capture the error but continue to postPolicy so session cleanup runs.
    testResult = { error: e.message };
  }

  // ── 5. Post-policy ──────────────────────────────────────────────────────────
  const action = postPolicy.action ?? (mode === 'clone' ? 'destroy' : 'save');

  try {
    if (action === 'destroy' || action === 'save') {
      await _sessionClose({ sessionName: runtimeName });
    } else if (action === 'keep') {
      try {
        _getSession(runtimeName);
      } catch {
        if (!postPolicy.recreateCloneOnKeep) {
          throw new Error(
            `Session "${runtimeName}" no longer open and recreateCloneOnKeep is false`
          );
        }
        await _sessionOpen({ sessionName: runtimeName });
      }
    }
  } catch (e) {
    return {
      session: { logicalName, runtimeName, mode },
      test:    testResult,
      error:   e.message,
      phase:   'postPolicy',
    };
  }

  // ── 6. Response ─────────────────────────────────────────────────────────────
  return {
    session: { logicalName, runtimeName, mode },
    test:    testResult,
  };
};
