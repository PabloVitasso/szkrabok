/**
 * D7 — blockedReason(url, { allowPrivateNet }) / assertNavigable in src/utils/url-guard.js
 *
 * Contract: blockedReason returns null when allowed, a reason string when not.
 * assertNavigable throws { code: 'URL_BLOCKED' }.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, withCode } from './helpers.js';

const mod = await load('src/utils/url-guard.js', 'D7');
const blockedReason = (...a) => mod.blockedReason(...a);
const assertNavigable = (...a) => mod.assertNavigable(...a);

const allowed = (url, opts) =>
  assert.equal(blockedReason(url, opts), null, `${url} should be allowed`);
const blocked = (url, opts) => assert.ok(blockedReason(url, opts), `${url} should be blocked`);

// ── schemes ───────────────────────────────────────────────────────────────────

test('http, https and about:blank are allowed', () => {
  for (const u of [
    'https://example.com/',
    'http://example.com:8080/a?b#c',
    'about:blank',
    'about:blank#x',
  ]) {
    allowed(u);
  }
});

test('non-web schemes are blocked', () => {
  for (const u of [
    'file:///etc/hostname',
    'FILE:///etc/hostname',
    'chrome://version',
    'chrome-extension://abc/x.html',
    'devtools://devtools/bundled/inspector.html',
    'view-source:https://example.com',
    'javascript:void(0)',
    'data:text/html,hi',
    'blob:https://example.com/uuid',
    'filesystem:https://example.com/temporary/x',
    'ftp://example.com/',
    'ws://example.com/',
    'about:config',
    'about:srcdoc',
  ]) {
    blocked(u);
  }
});

test('scheme block is not lifted by allowPrivateNet', () => {
  blocked('file:///etc/hostname', { allowPrivateNet: true });
  blocked('chrome://version', { allowPrivateNet: true });
});

test('invalid and relative URLs are blocked', () => {
  for (const u of ['', 'not a url', '/etc/hostname', 'example.com', undefined, null]) {
    blocked(u);
  }
});

// ── private destinations ──────────────────────────────────────────────────────

test('loopback names are blocked', () => {
  for (const u of [
    'http://localhost/',
    'http://LOCALHOST:8932/',
    'http://a.localhost/',
    'https://localhost.',
  ]) {
    blocked(u);
  }
});

test('private and special IPv4 literals are blocked', () => {
  for (const u of [
    'http://127.0.0.1/',
    'http://127.255.255.254/',
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
  ]) {
    blocked(u);
  }
});

test('alternate IPv4 spellings are normalized and blocked', () => {
  for (const u of [
    'http://2130706433/', // decimal 127.0.0.1
    'http://0x7f000001/', // hex
    'http://0177.0.0.1/', // octal
    'http://127.1/', // short form
    'http://0x7f.1/',
    'http://3232235777/', // 192.168.1.1
    'http://127.0.0.1./', // trailing dot
  ]) {
    blocked(u);
  }
});

test('public IPv4 literals and lookalike ranges are allowed', () => {
  for (const u of [
    'http://93.184.215.14/',
    'http://172.15.0.1/',
    'http://172.32.0.1/',
    'http://192.169.0.1/',
    'http://100.63.0.1/',
    'http://11.0.0.1/',
  ]) {
    allowed(u);
  }
});

test('private IPv6 literals are blocked', () => {
  for (const u of [
    'http://[::1]/',
    'http://[::]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://[fe80::1]/',
    'http://[febf::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[ff02::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:192.168.0.1]/',
    'http://[::127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
  ]) {
    blocked(u);
  }
});

test('public IPv6 literals are allowed', () => {
  for (const u of [
    'http://[2606:2800:220:1::1]/',
    'http://[::ffff:93.184.215.14]/',
    'http://[fec0::1]/',
  ]) {
    allowed(u);
  }
});

test('ordinary hostnames are allowed (DNS rebinding is a documented residual)', () => {
  for (const u of [
    'https://example.com/',
    'https://localhost.example.com/',
    'https://my-localhost/',
    'https://127.0.0.1.nip.io/',
  ]) {
    allowed(u);
  }
});

test('allowPrivateNet lifts only the destination block', () => {
  for (const u of [
    'http://localhost:3000/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://192.168.1.1/',
  ]) {
    allowed(u, { allowPrivateNet: true });
  }
});

// ── assertNavigable ───────────────────────────────────────────────────────────

test('assertNavigable throws URL_BLOCKED with the reason', () => {
  assert.throws(() => assertNavigable('file:///etc/hostname'), withCode('URL_BLOCKED', 'file:'));
  assert.throws(
    () => assertNavigable('http://127.0.0.1/'),
    withCode('URL_BLOCKED', '--allow-private-net')
  );
});

test('assertNavigable returns the URL when allowed', () => {
  assert.equal(assertNavigable('https://example.com/'), 'https://example.com/');
});
