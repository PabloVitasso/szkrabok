// Run via MCP:
//   session.open  { "id": "p4n-test" }
//   browser.run_test { "id": "p4n-test", "grep": "park4night" }

import { test, expect } from '../fixtures';

const BASE_URL    = 'https://park4night.com/en';
const BANNER      = '.cc-section-landing';
const BTN_REJECT  = `${BANNER} .cc-btn.cc-btn-reject`;

test('acceptCookies', async ({ page }, testInfo) => {
  console.log('step 1. navigate to', BASE_URL);
  await page.goto(BASE_URL);

  console.log('step 2. probe for cookie banner (8s timeout)');
  const btn = page.locator(BTN_REJECT);
  const appeared = await btn.waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  console.log(`step 3. banner appeared: ${appeared}`);

  if (!appeared) {
    console.log('step 4. skipping — cookies already accepted');
    const result = { action: 'skipped', reason: 'banner_not_present' };
    await testInfo.attach('result', { body: JSON.stringify(result), contentType: 'application/json' });
    return;
  }

  const isVisible = await btn.isVisible();
  const isEnabled = await btn.isEnabled();
  console.log(`step 4. button state — visible: ${isVisible}, enabled: ${isEnabled}`);

  if (!isVisible || !isEnabled) {
    console.log('step 5. button not interactable — failing');
    const result = { action: 'failed', visible: isVisible, enabled: isEnabled };
    await testInfo.attach('result', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(isVisible && isEnabled, 'Cookie reject button not interactable').toBe(true);
    return;
  }

  console.log('step 5. clicking "Only essential cookies"');
  await btn.click();

  console.log('step 6. waiting for banner to disappear');
  await page.locator(BANNER).waitFor({ state: 'hidden', timeout: 5000 });
  const bannerGone = !(await page.locator(BANNER).isVisible());

  console.log(`step 7. banner gone: ${bannerGone}`);
  const result = { action: 'clicked', dismissed: bannerGone };
  await testInfo.attach('result', { body: JSON.stringify(result), contentType: 'application/json' });

  expect(bannerGone, 'Cookie banner should be gone after clicking reject').toBe(true);
  console.log('step 8. done');
});
