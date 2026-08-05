// Basic smoke tests using only the @szkrabok/runtime public API.
// Pool and storage internals are covered in selftest/runtime/unit.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSession, listRuntimeSessions, resolvePreset, initConfig } from '@szkrabok/runtime';

test('getSession throws for missing session', () => {
  assert.throws(() => getSession('nonexistent'), /session not found/);
});

test('listRuntimeSessions returns empty array initially', () => {
  const sessions = listRuntimeSessions();
  assert.ok(Array.isArray(sessions));
});

test('resolvePreset returns a valid preset object', () => {
  initConfig([]);
  const preset = resolvePreset('default');
  assert.ok(typeof preset.label === 'string');
  assert.ok(typeof preset.preset === 'string');
});

import { EngineNotSupportedError } from '@szkrabok/runtime';

test('EngineNotSupportedError has correct fields', () => {
  const err = new EngineNotSupportedError('browser_run_test', 'firefox', 'CDP not available');
  assert.equal(err.name, 'EngineNotSupportedError');
  assert.equal(err.code, 'ENGINE_NOT_SUPPORTED');
  assert.equal(err.operation, 'browser_run_test');
  assert.equal(err.engine, 'firefox');
  assert.ok(err.message.includes('browser_run_test'));
  assert.ok(err.message.includes('firefox'));
});
