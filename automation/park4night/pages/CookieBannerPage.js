/**
 * CookieBannerPage - handles cookie consent banner.
 */

import { humanClick } from '../../core/human.js';
import { attachResult } from '../../core/result.js';

export class CookieBannerPage {
  constructor(page) {
    this.page      = page;
    this.banner    = page.locator('.cc-section-landing');
    this.rejectBtn = page.locator('.cc-section-landing .cc-btn.cc-btn-reject');
  }

  async dismiss(testInfo) {
    const appeared = await this.rejectBtn
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true).catch(() => false);

    if (!appeared) {
      return attachResult(testInfo, { action: 'skipped', reason: 'banner_not_present' });
    }

    await this.rejectBtn.scrollIntoViewIfNeeded();
    await humanClick(this.page, '.cc-section-landing .cc-btn.cc-btn-reject');
    await this.banner.waitFor({ state: 'hidden', timeout: 3000 });
    return attachResult(testInfo, { action: 'clicked', dismissed: true });
  }
}
