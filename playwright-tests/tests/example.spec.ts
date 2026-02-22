import { test, expect } from '@playwright/test';

// Parameters via env vars. Pass via browser.run_test params:{} or manually:
//   TEST_URL=https://example.com TEST_TITLE=Example npx playwright test
const TARGET_URL   = process.env.TEST_URL   ?? 'https://playwright.dev/';
const EXPECT_TITLE = process.env.TEST_TITLE ?? 'Playwright';
const LINK_NAME    = process.env.TEST_LINK  ?? 'Get started';

test('page title check', async ({ page }, testInfo) => {
  await page.goto(TARGET_URL);

  const title = await page.title();
  await expect(page).toHaveTitle(new RegExp(EXPECT_TITLE));

  // Structured JSON result available in browser.run_test output via attachments.
  await testInfo.attach('result', {
    body: JSON.stringify({ title, url: TARGET_URL, matched: EXPECT_TITLE }),
    contentType: 'application/json',
  });
});

test('navigation link check', async ({ page }, testInfo) => {
  await page.goto(TARGET_URL);

  await page.getByRole('link', { name: LINK_NAME }).click();
  const heading = page.getByRole('heading', { name: 'Installation' });
  await expect(heading).toBeVisible();

  const headingText = await heading.textContent();
  await testInfo.attach('result', {
    body: JSON.stringify({ clicked: LINK_NAME, heading: headingText, url: page.url() }),
    contentType: 'application/json',
  });
});
