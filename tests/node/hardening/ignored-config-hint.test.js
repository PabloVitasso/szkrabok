/**
 * D8 + --trust-project-config: a project config that was found but not loaded
 * is named in BROWSER_NOT_FOUND, so the fix is visible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserNotFoundError } from '../../../packages/runtime/errors.js';

const meta = extra => ({ phase: 'final', source: 'none (no config file found)', ...extra });

test('ignored project config is named in the hint and context', () => {
  const json = new BrowserNotFoundError({
    configMeta: meta({ ignored: ['/home/u/project'] }),
  }).toJSON();
  assert.match(json.hint, /\/home\/u\/project/);
  assert.match(json.hint, /--trust-project-config/);
  assert.deepEqual(json.context.config.ignored, ['/home/u/project']);
});

test('without ignored configs the hint is unchanged', () => {
  const plain = new BrowserNotFoundError({ configMeta: meta({}) }).toJSON();
  const empty = new BrowserNotFoundError({ configMeta: meta({ ignored: [] }) }).toJSON();
  assert.equal(plain.hint, empty.hint);
  assert.doesNotMatch(plain.hint, /--trust-project-config/);
  assert.equal(plain.context.config.ignored, undefined);
});
