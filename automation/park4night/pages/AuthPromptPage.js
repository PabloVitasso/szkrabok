/**
 * AuthPromptPage - handles authentication modal/prompt.
 */

import { expect } from 'playwright/test';
import { humanClick, humanType, openHoverMenuAndClick } from '../../core/human.js';

export class AuthPromptPage {
  constructor(page) {
    this.page = page;
    this.myAccountButton = page.locator('nav.pageHeader-account button.pageHeader-account-button');
    this.myAccountDropdown = page.locator('ul.pageHeader-account-dropdown');
    this.dropdownLoginOption = page.locator(
      'ul.pageHeader-account-dropdown button[data-bs-target="#signinModal"]'
    );
    this.loginModal = page.locator('div#signinModal form.modal-content');
    this.emailInput = page.locator('input#signinUserId');
    this.passwordInput = page.locator('input#signinPassword');
    this.submitBtn = page.locator('div#signinModal form.modal-content button[type=submit]');
    this.errorMessage = page.getByRole('alert');

    this.whenNotLoggedText = 'My account'; // this appears on button when not logged in
  }

  async login(email, password) {
    await openHoverMenuAndClick(this.page, this.myAccountButton, this.dropdownLoginOption, {
      hoverDelay: 800,
      timeout: 10000,
    });
    await this.loginModal.waitFor({ state: 'visible', timeout: 5000 });
    await humanType(this.page, this.emailInput, email, { occasionalTypo: false });
    await humanType(this.page, this.passwordInput, password, { occasionalTypo: false });
    await humanClick(this.page, this.submitBtn);
    await this.loginModal.waitFor({ state: 'hidden', timeout: 5000 });
  }

  async checkLoginState({ timeout = 0, interval = 500 } = {}) {
    const check = async () => {
      const buttonCount = await this.myAccountButton.count();
      if (buttonCount === 0) {
        console.log('[checkLoginState] button not found in DOM');
        return 'unknown';
      }
      const loggedIn =
        (await this.myAccountButton.filter({ hasNotText: this.whenNotLoggedText }).count()) > 0;
      const loggedOut =
        (await this.myAccountButton.filter({ hasText: this.whenNotLoggedText }).count()) > 0;
      const state = loggedIn ? 'loggedIn' : loggedOut ? 'loggedOut' : 'unknown';
      console.log(`[checkLoginState] button found, state=${state}`);
      return state;
    };

    if (timeout === 0) return check();

    let result = 'unknown';
    await expect
      .poll(
        async () => {
          result = await check();
          return result;
        },
        { intervals: [interval], timeout }
      )
      .not.toBe('unknown');
    return result;
  }

  async isLoggedIn({ timeout = 0, interval = 500 } = {}) {
    return (await this.checkLoginState({ timeout, interval })) === 'loggedIn';
  }

  async isLoggedOut({ timeout = 0, interval = 500 } = {}) {
    return (await this.checkLoginState({ timeout, interval })) === 'loggedOut';
  }

  async getError() {
    return (await this.errorMessage.textContent()) ?? '';
  }
}
