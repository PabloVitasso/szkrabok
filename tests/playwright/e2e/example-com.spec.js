/**
 * Minimal live-browser smoke spec.
 * Navigates to example.com and asserts on real page content.
 * Used by EX-2.4 to verify the clone browser is actually running and connected.
 */
import { test, expect } from './fixtures.js';

// The live page no longer has an <h1> (verified 2026-10-24); assert on the
// title and its "Learn more" link instead.
test('example.com title and content', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle('Example Domain');
  await expect(page.getByRole('link', { name: /learn more/i })).toBeVisible();
});
