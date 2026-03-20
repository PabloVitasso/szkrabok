import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run_test } from '../../src/tools/szkrabok_browser.js';

test('run_test returns structured error when playwright.config.js is missing', async () => {
  const result = await run_test({
    sessionName: 'test-session',
    config: 'nonexistent-playwright.config.js',
  });

  assert.ok(result.error, 'should have error field');
  assert.ok(result.hint, 'should have hint field');
  assert.match(result.hint, /scaffold_init/);
});
