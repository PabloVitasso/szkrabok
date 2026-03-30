/**
 * Minimal live-browser smoke spec.
 * Navigates to example.com and asserts on real page content.
 * Used by EX-2.4 to verify the clone browser is actually running and connected.
 */
import { test, expect } from './fixtures.js';

test('example.com title and heading', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle('Example Domain');
  await expect(page.locator('h1')).toHaveText('Example Domain');
});
