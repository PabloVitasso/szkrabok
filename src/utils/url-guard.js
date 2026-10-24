// Navigation guard (hardening proposal D7). The browser runs on the host, so a
// tool-chosen URL must neither read host files (file:, chrome:, ...) nor reach
// host-local/private network services (loopback, link-local, RFC 1918, ULA).
//
// Pure: classifies a URL string; enforcement lives in src/tools/nav_guard.js.

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// ── IPv4 ──────────────────────────────────────────────────────────────────────

const isPrivateV4 = ([a, b]) =>
  a === 0 || // "this network", 0.0.0.0
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  a >= 224; // multicast, reserved, broadcast

const V4_LITERAL = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// ── IPv6 ──────────────────────────────────────────────────────────────────────

/** Expand a (URL-normalized, unbracketed) IPv6 literal to 8 numeric hextets. */
const expandV6 = host => {
  const [head, tail] = host.includes('::') ? host.split('::') : [host, null];
  const parse = part => (part ? part.split(':').map(h => parseInt(h, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  const fill = tail === null ? [] : new Array(8 - left.length - right.length).fill(0);
  const all = [...left, ...fill, ...right];
  return all.length === 8 && all.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? all
    : null;
};

const embeddedV4 = (h6, h7) => [h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff];

const isPrivateV6 = host => {
  const h = expandV6(host);
  if (!h) return true; // unparseable literal: refuse rather than guess
  const zeroPrefix = n => h.slice(0, n).every(x => x === 0);

  if (zeroPrefix(8)) return true; // ::
  if (zeroPrefix(7) && h[7] === 1) return true; // ::1
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // IPv4-mapped ::ffff:a.b.c.d and deprecated IPv4-compatible ::a.b.c.d
  if (zeroPrefix(5) && (h[5] === 0xffff || h[5] === 0)) return isPrivateV4(embeddedV4(h[6], h[7]));
  // NAT64 64:ff9b::/96
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every(x => x === 0)) {
    return isPrivateV4(embeddedV4(h[6], h[7]));
  }
  return false;
};

// ── public ────────────────────────────────────────────────────────────────────

/**
 * Why `raw` must not be navigated to, or null when it is allowed.
 * Hostname forms are classified after WHATWG URL normalization, so decimal,
 * hex, octal and short IPv4 spellings are caught as their dotted form.
 * DNS names that resolve to private addresses are NOT caught (documented
 * residual risk, D7).
 */
export const blockedReason = (raw, { allowPrivateNet = false } = {}) => {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid URL';
  }

  if (url.protocol === 'about:') {
    return url.pathname === 'blank'
      ? null
      : `${url.protocol}${url.pathname} is not allowed (only about:blank)`;
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return `scheme ${url.protocol} is not allowed`;
  if (allowPrivateNet) return null;

  // A trailing dot is the same DNS name ("localhost." resolves like "localhost").
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return `host ${host} is loopback (needs --allow-private-net)`;
  }
  if (host.startsWith('[')) {
    return isPrivateV6(host.slice(1, -1))
      ? `address ${host} is private (needs --allow-private-net)`
      : null;
  }
  const v4 = V4_LITERAL.exec(host);
  if (v4 && isPrivateV4(v4.slice(1, 3).map(Number))) {
    return `address ${host} is private (needs --allow-private-net)`;
  }
  return null;
};

export class UrlBlockedError extends Error {
  constructor(url, reason) {
    super(`navigation to ${JSON.stringify(url)} blocked: ${reason}`);
    this.name = 'UrlBlockedError';
    this.code = 'URL_BLOCKED';
  }
}

export const assertNavigable = (url, opts) => {
  const reason = blockedReason(url, opts);
  if (reason) throw new UrlBlockedError(url, reason);
  return url;
};
