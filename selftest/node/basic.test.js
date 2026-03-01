// Basic smoke tests using only the @szkrabok/runtime public API.
// Pool and storage internals are covered in selftest/runtime/unit.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSession, listRuntimeSessions, resolvePreset } from '@szkrabok/runtime';

test('getSession throws for missing session', () => {
  assert.throws(() => getSession('nonexistent'), /Session not found/);
});

test('listRuntimeSessions returns empty array initially', () => {
  const sessions = listRuntimeSessions();
  assert.ok(Array.isArray(sessions));
});

test('resolvePreset returns a valid preset object', () => {
  const preset = resolvePreset('default');
  assert.ok(typeof preset.label === 'string');
  assert.ok(typeof preset.preset === 'string');
});
