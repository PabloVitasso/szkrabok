/**
 * Human-like behavior utilities for automation.
 * Moved from scripts/human.js for sharing across all page objects.
 */

const toLocator = (page, selector) =>
  typeof selector === 'string' ? page.locator(selector) : selector;

/**
 * Generates a random number from a Gaussian (normal) distribution.
 * Uses Box-Muller transform.
 *
 * @param {number} mean - The mean of the distribution
 * @param {number} stdDev - The standard deviation of the distribution
 * @returns {number} A random number from the Gaussian distribution
 */
function gaussian(mean, stdDev) {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Generates a random number within a range.
 *
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (exclusive)
 * @returns {number} A random number between min and max
 */
function rand(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Types text into an element with human-like behavior.
 * Simulates realistic typing patterns including variable speed,
 * occasional typos, and natural pauses.
 *
 * @param {import('playwright').Page} page - Playwright page instance
 * @param {string} selector - CSS selector for the input element
 * @param {string} text - Text to type
 * @param {{occasionalTypo?: boolean}} [options] - Typing options
 * @param {boolean} [options.occasionalTypo=false] - Whether to include occasional typos (default: false)
 * @returns {Promise<void>}
 */
export async function humanType(page, selector, text, options = {}) {
  const { occasionalTypo = false } = options;

  await humanClick(page, selector);
  //const locator = page.locator(selector);
  //await locator.click();

  const typoChance = occasionalTypo ? 0.025 : 0;
  const pauseAfterWordChance = 0.15;

  let inWordIndex = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Word boundary detection
    const isWordChar = /\w/.test(char);
    if (!isWordChar) inWordIndex = 0;

    // Occasional typo (more likely in long words)
    if (Math.random() < typoChance && isWordChar && inWordIndex > 2) {
      const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
      await page.keyboard.type(wrongChar, { delay: gaussian(60, 20) });
      await page.waitForTimeout(gaussian(120, 40));
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(gaussian(80, 30));
    }

    // Base speed profile
    let delay;

    if (!isWordChar) {
      // punctuation / space → pause
      delay = gaussian(180, 60);
      if (Math.random() < pauseAfterWordChance) delay += gaussian(250, 100);
    } else {
      // inside word burst
      delay = gaussian(70, 25);

      // first letter of word slightly slower
      if (inWordIndex === 0) delay += gaussian(40, 20);
    }

    // Shift / uppercase hesitation
    if (/[A-Z]/.test(char)) {
      delay += gaussian(50, 20);
    }

    delay = Math.max(20, delay);

    await page.keyboard.type(char, { delay });

    if (isWordChar) inWordIndex++;
  }

  await page.waitForTimeout(gaussian(150, 50));
}

/**
 * Clicks an element using human-like mouse movement.
 * Moves the mouse with a curved trajectory using ease-in/out.
 *
 * @param {import('playwright').Page} page - Playwright page instance
 * @param {string} selector - CSS selector for the element to click
 * @returns {Promise<void>}
 * @throws {Error} If the element is not visible
 */
export async function humanClick(page, selector) {
  const locator = toLocator(page, selector);

  // Ensure visible (human would scroll)
  await locator.scrollIntoViewIfNeeded();

  const box = await locator.boundingBox();
  if (!box) throw new Error('Element not visible');

  const viewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));

  if (!viewport?.width || !viewport?.height) throw new Error('Viewport unavailable');

  // Start from random visible position
  const startX = rand(0, viewport.width);
  const startY = rand(0, viewport.height);

  // Click at random point inside element (not center)
  const padding = Math.min(10, box.width / 4, box.height / 4);

  const targetX = rand(box.x + padding, box.x + box.width - padding);

  const targetY = rand(box.y + padding, box.y + box.height - padding);

  const steps = Math.floor(rand(18, 35));

  // Smooth movement with slight noise
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t);

    const x = startX + (targetX - startX) * ease + rand(-2, 2);

    const y = startY + (targetY - startY) * ease + rand(-2, 2);

    await page.mouse.move(x, y);
    await page.waitForTimeout(Math.max(4, gaussian(10, 3)));
  }

  // Micro adjustment near target (human correction)
  if (Math.random() < 0.7) {
    await page.mouse.move(targetX + rand(-1.5, 1.5), targetY + rand(-1.5, 1.5));
    await page.waitForTimeout(rand(20, 80));
  }

  // Pre-click hesitation
  await page.waitForTimeout(rand(60, 180));

  // Down / up asymmetry
  await page.mouse.down();
  await page.waitForTimeout(Math.max(20, gaussian(60, 20)));
  await page.mouse.up();

  // Small post-click pause
  await page.waitForTimeout(rand(80, 200));
}

/**
 * Simulates human behavior after page load.
 * Includes reading delay, mouse movement, scrolling, and pauses
 * to mimic natural user behavior.
 *
 * @param {import('playwright').Page} page - Playwright page instance
 * @returns {Promise<void>}
 */
export async function humanizeOnLoad(page) {
  // Initial idle delay (reading time)
  await page.waitForTimeout(rand(400, 1200));

  // Robust viewport detection
  const viewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));

  if (!viewport?.width || !viewport?.height) return;

  // Randomize whether we move mouse at all
  if (Math.random() < 0.85) {
    const margin = 50;

    const startX = rand(0, viewport.width);
    const startY = rand(0, viewport.height);

    const targetX = rand(margin, Math.max(margin, viewport.width - margin));

    const targetY = rand(margin, Math.max(margin, viewport.height - margin));

    const steps = Math.floor(rand(15, 35));

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const ease = t * t * (3 - 2 * t); // smoothstep easing

      const x = startX + (targetX - startX) * ease + rand(-3, 3);

      const y = startY + (targetY - startY) * ease + rand(-3, 3);

      await page.mouse.move(x, y);
      await page.waitForTimeout(rand(5, 15));
    }
  }

  // Check if page can scroll
  const canScroll = await page.evaluate(() => document.body.scrollHeight > window.innerHeight);

  let totalScrolled = 0;

  if (canScroll && Math.random() < 0.75) {
    const scrollAmount = rand(200, 600);
    const scrollSteps = Math.floor(rand(5, 12));

    for (let i = 0; i < scrollSteps; i++) {
      await page.mouse.wheel(0, scrollAmount / scrollSteps);
      await page.waitForTimeout(Math.max(30, gaussian(80, 25)));
    }
    totalScrolled += scrollAmount;

    // Occasional upward correction
    if (Math.random() < 0.6) {
      const correction = rand(50, 200);
      await page.waitForTimeout(rand(200, 600));
      await page.mouse.wheel(0, -correction);
      totalScrolled -= correction;
    }
  }

  // Always return to top
  if (totalScrolled > 0) {
    await page.waitForTimeout(rand(200, 500));
    const returnSteps = Math.floor(rand(4, 10));
    for (let i = 0; i < returnSteps; i++) {
      await page.mouse.wheel(0, -(totalScrolled + rand(0, 60)) / returnSteps);
      await page.waitForTimeout(Math.max(25, gaussian(60, 20)));
    }
  }

  // Final reading pause
  await page.waitForTimeout(rand(800, 2000));
}

export async function openHoverMenuAndClick(page, triggerSelector, itemSelector, options = {}) {
  const { hoverDelay = 250, moveSteps = 14, timeout = 5000 } = options;

  const randomPoint = box => ({
    x: box.x + box.width * (0.45 + Math.random() * 0.1),
    y: box.y + box.height * (0.45 + Math.random() * 0.1),
  });

  // --- Hover trigger ---
  const trigger = toLocator(page, triggerSelector).first();
  await trigger.waitFor({ state: 'visible', timeout });

  const triggerBox = await trigger.boundingBox();
  if (!triggerBox) throw new Error('Trigger not interactable');

  const start = randomPoint(triggerBox);

  await page.mouse.move(start.x, start.y, { steps: moveSteps });
  await page.waitForTimeout(hoverDelay);

  // --- Wait for dropdown item AFTER hover ---
  const item = toLocator(page, itemSelector).first();
  await item.waitFor({ state: 'attached', timeout });
  await item.waitFor({ state: 'visible', timeout });

  // Recalculate box right before click (handles animation shifts)
  const itemBox = await item.boundingBox();
  if (!itemBox) throw new Error('Dropdown item not interactable');

  const target = randomPoint(itemBox);

  await page.mouse.move(target.x, target.y, { steps: moveSteps });
  await page.waitForTimeout(30 + Math.random() * 40);

  await page.mouse.click(target.x, target.y);
}
