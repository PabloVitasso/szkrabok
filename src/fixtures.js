import { test as base, chromium } from '@playwright/test';
import { writeAttachSignal }       from './attach-signal.js';

export { expect } from '@playwright/test';

// ── Configuration validation ──────────────────────────────────────────────────
// Runs before session creation. Rejects invalid combinations explicitly.
function resolveConfig({ szkrabokCdpEndpoint, szkrabokSessionMode }) {
  const isCdp = !!szkrabokCdpEndpoint;

  if (isCdp && szkrabokSessionMode !== 'template') {
    // szkrabokSessionMode controls standalone launch behaviour (template vs clone).
    // In CDP mode the session is managed externally — the option has no effect and
    // a non-default value almost certainly indicates a misconfiguration.
    throw new Error(
      `szkrabokSessionMode "${szkrabokSessionMode}" is invalid in CDP mode — ` +
      `session lifecycle is managed externally. Remove szkrabokSessionMode or set it to "template".`
    );
  }

  return { mode: isCdp ? 'cdp' : 'standalone' };
}

// ── Session factories ─────────────────────────────────────────────────────────

async function createCdpSession(endpoint) {
  const browser  = await chromium.connectOverCDP(endpoint);
  const context  = browser.contexts()[0] ?? await browser.newContext();
  return { browser, context, mode: 'cdp', ownsBrowser: false };
}

async function createStandaloneSession(profile, sessionMode) {
  // Dynamic import: only evaluated in standalone mode. Fails with a clear
  // "package not installed" error rather than a cryptic resolution crash.
  const { initConfig, launch, launchClone } =
    await import('@pablovitasso/szkrabok/runtime');
  initConfig();

  if (sessionMode === 'template') {
    const handle = await launch({ profile, reuse: true });
    return { ...handle, mode: 'standalone', ownsBrowser: true };
  }
  if (sessionMode === 'clone') {
    const handle = await launchClone({ profile });
    return { ...handle, mode: 'standalone', ownsBrowser: true };
  }
  throw new Error(
    `Invalid szkrabokSessionMode: "${sessionMode}". Expected "template" or "clone".`
  );
}

// ── Fixture definition ────────────────────────────────────────────────────────

export const test = base.extend({

  szkrabokProfile:      ['sessions/dev',                                    { option: true, scope: 'worker' }],
  szkrabokCdpEndpoint:  [process.env.SZKRABOK_CDP_ENDPOINT  ?? '',          { option: true, scope: 'worker' }],
  szkrabokAttachSignal: [process.env.SZKRABOK_ATTACH_SIGNAL ?? '',          { option: true, scope: 'worker' }],
  szkrabokSessionMode:  [process.env.SESSIONMODE            ?? 'template',  { option: true, scope: 'worker' }],

  session: [async ({ szkrabokProfile, szkrabokCdpEndpoint, szkrabokAttachSignal, szkrabokSessionMode }, use) => {
    const { mode } = resolveConfig({ szkrabokCdpEndpoint, szkrabokSessionMode });

    if (process.env.DEBUG?.includes('szkrabok')) {
      if (mode === 'cdp') {
        console.debug(`[szkrabok] mode=cdp  endpoint=${szkrabokCdpEndpoint}`);
      } else {
        console.debug(`[szkrabok] mode=standalone  profile=${szkrabokProfile}  sessionMode=${szkrabokSessionMode}`);
      }
    }

    let session;
    if (mode === 'cdp') {
      session = await createCdpSession(szkrabokCdpEndpoint);
      // Signal written HERE — at attach time, before tests start.
      // Semantically correct: the signal means "CDP attached", not "tests complete".
      await writeAttachSignal(szkrabokAttachSignal);
    } else {
      session = await createStandaloneSession(szkrabokProfile, szkrabokSessionMode);
    }

    await use(session);

    if (session.ownsBrowser) await session.browser.close();
    // CDP: do not close — MCP session owns this browser (ownsBrowser: false).
  }, { scope: 'worker' }],

  browser: [async ({ session }, use) => {
    await use(session.browser);
  }, { scope: 'worker' }],

  page: async ({ session }, use) => {
    const ctx  = session.context;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await use(page);
  },
});
