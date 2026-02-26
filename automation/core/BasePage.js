/**
 * BasePage - shared navigation and wait utilities for all page objects.
 * Site-agnostic core that all page objects extend.
 */

import { humanizeOnLoad, humanClick } from './human.js';

export class BasePage {
  /**
   * @param {import('playwright').Page} page - Playwright page instance
   * @param {object} config - Site configuration object (baseUrl + selectors)
   */
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  /**
   * Navigate to a path and humanize on load.
   * @param {string} [path=''] - Path to navigate to (appended to baseUrl)
   */
  async goto(path = '') {
    await this.page.goto(this.config.baseUrl + path);
    await humanizeOnLoad(this.page);
  }

  /**
   * Wait for a selector to be visible.
   * @param {string} selector - CSS selector
   * @param {number} [timeout=3000] - Timeout in ms
   * @returns {Promise<boolean>} True if visible, false if timeout
   */
  async waitForVisible(selector, timeout = 3000) {
    return this.page.locator(selector)
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Wait for a selector to be hidden.
   * @param {string} selector - CSS selector
   * @param {number} [timeout=3000] - Timeout in ms
   * @returns {Promise<boolean>} True if hidden, false if timeout
   */
  async waitForHidden(selector, timeout = 3000) {
    return this.page.locator(selector)
      .waitFor({ state: 'hidden', timeout })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Check if a selector is present in the DOM.
   * @param {string} selector - CSS selector
   * @returns {Promise<boolean>} True if present
   */
  async isPresent(selector) {
    return this.page.locator(selector).count() > 0;
  }

  /**
   * Check if a selector is visible.
   * @param {string} selector - CSS selector
   * @returns {Promise<boolean>} True if visible
   */
  async isVisible(selector) {
    return this.page.locator(selector).isVisible();
  }

  /**
   * Click an element with human-like mouse movement.
   * @param {string} selector - CSS selector
   */
  async click(selector) {
    await this.page.locator(selector).scrollIntoViewIfNeeded();
    await humanClick(this.page, selector);
  }

  /**
   * Attach a result object to the test info.
   * @param {import('playwright').TestInfo} testInfo - Playwright testInfo
   * @param {object} result - Result object to attach
   */
  async attachResult(testInfo, result) {
    await testInfo.attach('result', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
  }

  /**
   * Get a selector from the site's selector config.
   * @param {string} key - Key in the selectors config
   * @returns {string} The selector string
   */
  getSelector(key) {
    return this.config.selectors[key];
  }
}
