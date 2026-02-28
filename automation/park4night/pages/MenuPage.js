/**
 * MenuPage - handles navigation menu interactions.
 */

import { humanClick } from '../../core/human.js';

export class MenuPage {
  constructor(page) {
    this.page = page;
    this.menuBtn = page.getByRole('button', { name: 'Menu' });
  }

  async open(itemName) {
    await this.menuBtn.scrollIntoViewIfNeeded();
    await humanClick(this.page, '[aria-label="Menu"]');
    await this.page.getByRole('menuitem', { name: itemName }).click();
  }
}
