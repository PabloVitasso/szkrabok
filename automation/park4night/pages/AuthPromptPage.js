/**
 * AuthPromptPage - handles authentication modal/prompt.
 */

import { humanClick } from '../../core/human.js';

export class AuthPromptPage {
  constructor(page) {
    this.page          = page;
    this.modal         = page.locator('[role="dialog"]');
    this.emailInput    = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.submitBtn     = page.getByRole('button', { name: 'Login' });
    this.errorMessage  = page.getByRole('alert');
  }

  async login(email, password) {
    await this.modal.waitFor({ state: 'visible', timeout: 5000 });
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await humanClick(this.page, 'button[type="submit"]');
  }

  async isLoggedIn() {
    return this.modal
      .waitFor({ state: 'hidden', timeout: 5000 })
      .then(() => true).catch(() => false);
  }

  async getError() {
    return (await this.errorMessage.textContent()) ?? '';
  }
}
