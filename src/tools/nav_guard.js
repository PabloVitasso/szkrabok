// Navigation guard enforcement (hardening proposal D7). Three layers:
//   1. call site  — assertToolUrl() before every tool-driven goto
//   2. context    — route block for private destinations (all requests,
//                   redirects, page-initiated fetches) and a main-frame
//                   watcher for non-web schemes, which routing never sees
//   3. read side  — assertReadable() before returning page content

import { blockedReason, assertNavigable, UrlBlockedError } from '../utils/url-guard.js';
import { getCapabilities } from '../flags.js';
import { log } from '../utils/logger.js';

const opts = () => ({ allowPrivateNet: getCapabilities().privateNet });

// Chromium's own error page after a failed or aborted navigation.
const isErrorPage = url => url.startsWith('chrome-error://');

export const assertToolUrl = url => assertNavigable(url, opts());

/** Refuse to read a page whose document URL fails the guard. */
export const assertReadable = page => {
  const url = page.url();
  if (isErrorPage(url)) return;
  const reason = blockedReason(url, opts());
  if (reason) throw new UrlBlockedError(url, `refusing to read page content: ${reason}`);
};

const guardedContexts = new WeakSet();
const guardedPages = new WeakSet();

const watchPage = page => {
  if (guardedPages.has(page)) return;
  guardedPages.add(page);
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (isErrorPage(url)) return;
    const reason = blockedReason(url, opts());
    if (!reason) return;
    log(`[WARN] nav guard: main frame reached ${url} (${reason}) — resetting to about:blank`);
    page.goto('about:blank').catch(() => {});
  });
};

/**
 * Install the context-level layer once per browser context. Idempotent.
 * Routing disables the HTTP cache in Chromium, so the route is only installed
 * while private destinations are blocked (no --allow-private-net).
 * Not covered (documented residuals): requests a Service Worker answers or
 * issues itself, and DNS names that resolve to private addresses.
 */
export const installNavGuard = async session => {
  const { context } = session;
  if (!context || guardedContexts.has(context)) return;
  guardedContexts.add(context);

  context.pages().forEach(watchPage);
  context.on('page', watchPage);

  if (opts().allowPrivateNet) return;
  await context.route('**/*', route => {
    const url = route.request().url();
    const reason = blockedReason(url, opts());
    if (reason) {
      log(`[WARN] nav guard: blocked request ${url} (${reason})`);
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });

  // WebSockets bypass context.route. Check the destination only: ws/wss map to
  // http/https so the scheme allowlist does not block every socket.
  await context.routeWebSocket(
    url => !!blockedReason(String(url).replace(/^ws/, 'http'), opts()),
    ws => {
      log(`[WARN] nav guard: blocked WebSocket ${ws.url()}`);
      return ws.close();
    }
  );
};
