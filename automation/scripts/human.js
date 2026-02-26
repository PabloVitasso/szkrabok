export async function humanClick(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error('Element not visible');

  const startX = Math.random() * 200 + 50; // random start
  const startY = Math.random() * 200 + 50;

  const steps = 25 + Math.floor(Math.random() * 15);

  const targetX = box.x + box.width / 2;
  const targetY = box.y + box.height / 2;

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    // ease-in/out
    const ease = t * t * (3 - 2 * t);
    const x = startX + (targetX - startX) * ease;
    const y = startY + (targetY - startY) * ease;
    await page.mouse.move(x, y, { steps: 1 });
    await page.waitForTimeout(Math.random() * 5 + 10);
  }

  await page.waitForTimeout(Math.random() * 100 + 100);
  await page.mouse.down();
  await page.waitForTimeout(Math.random() * 50 + 50);
  await page.mouse.up();
}
