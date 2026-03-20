/**
 * Minimal spec used by session_run_test integration tests.
 * Imports e2e fixture so the _runtimeHandle worker fixture runs — this is what
 * writes SZKRABOK_ATTACH_SIGNAL at teardown when invoked via browser_run_test.
 */
import { test } from './fixtures.js';

test('noop', async ({ page }) => {
  // Nothing to assert — just exercises fixture setup/teardown.
  void page;
});
