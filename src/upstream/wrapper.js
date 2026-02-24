import { chromium } from 'playwright';
import { enhanceWithStealth, applyStealthToExistingPage } from '../core/szkrabok_stealth.js';
import { TIMEOUT, HEADLESS, findChromiumPath } from '../config.js';
import { log } from '../utils/logger.js';

let browser = null;

export const getBrowser = async (options = {}) => {
  if (!browser) {
    const pw = options.stealth ? enhanceWithStealth(chromium) : chromium;
    const executablePath = findChromiumPath();

    if (executablePath) {
      log('Using existing Chromium', { path: executablePath });
    }

    browser = await pw.launch({
      headless: options.headless ?? HEADLESS,
      executablePath,
      ...options,
    });
  }
  return browser;
};

export const launchPersistentContext = async (userDataDir, options = {}) => {
  // presetConfig carries identity fields (userAgent, locale, overrideUserAgent)
  // needed by the stealth user-agent-override evasion.
  const presetConfig = options.presetConfig ?? {};
  const pw = options.stealth ? enhanceWithStealth(chromium, presetConfig) : chromium;
  const executablePath = findChromiumPath();

  if (executablePath) {
    log('Using existing Chromium for persistent context', { path: executablePath });
  }

  const launchOptions = {
    ...options,
    headless: options.headless ?? HEADLESS,
    executablePath,
    viewport: options.viewport,
    locale: options.locale,
    timezoneId: options.timezoneId,
    // userAgent is set at context level for reliable spoofing with launchPersistentContext.
    // The user-agent-override stealth evasion additionally sets userAgentMetadata (brands,
    // platform) via CDP on new pages — but cannot reach the initial persistent context page
    // due to onPageCreated hook timing. See docs/launchpersistentcontext-stealth-issue.md.
    userAgent: options.userAgent,
  };

  // Remove options that are not valid for launchPersistentContext
  delete launchOptions.stealth;
  delete launchOptions.presetConfig;

  // Suppress "Chromium did not shut down correctly" restore bubble.
  // Appears when the MCP server process is killed before Chrome can write
  // exit_type: "Normal" to the profile Preferences file.
  launchOptions.args = ['--hide-crash-restore-bubble', ...(launchOptions.args || [])];

  // Enable CDP remote debugging on the given port so tests can connectOverCDP
  if (launchOptions.cdpPort) {
    launchOptions.args = [
      ...launchOptions.args,
      `--remote-debugging-port=${launchOptions.cdpPort}`,
    ];
    delete launchOptions.cdpPort;
  }

  const context = await pw.launchPersistentContext(userDataDir, launchOptions);

  // Option B workaround: playwright-extra's onPageCreated never fires for the
  // initial page of launchPersistentContext. Manually apply evasions via CDP
  // (Network.setUserAgentOverride, Page.addScriptToEvaluateOnNewDocument) so
  // userAgentData, hardwareConcurrency, webgl.vendor, navigator.languages are
  // spoofed on all future navigations of this page.
  if (options.stealth) {
    const pages = context.pages();
    if (pages.length > 0) {
      await applyStealthToExistingPage(pages[0], presetConfig);
    }
  }

  return context;
};

export const closeBrowser = async () => {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
};

export const navigate = async (page, url, options = {}) => {
  return page.goto(url, {
    waitUntil: options.waitUntil || 'domcontentloaded',
    timeout: options.timeout || TIMEOUT,
  });
};

export const click = async (page, selector, options = {}) => {
  return page.click(selector, {
    timeout: options.timeout || TIMEOUT,
  });
};

export const type = async (page, selector, text, options = {}) => {
  return page.fill(selector, text, {
    timeout: options.timeout || TIMEOUT,
  });
};

export const select = async (page, selector, value, options = {}) => {
  return page.selectOption(selector, value, {
    timeout: options.timeout || TIMEOUT,
  });
};

export const getText = async (page, selector = null) => {
  if (selector) {
    return page.textContent(selector);
  }
  return page.content();
};

export const getHtml = async (page, selector = null) => {
  if (selector) {
    return page.innerHTML(selector);
  }
  return page.content();
};

export const screenshot = async (page, options = {}) => {
  return page.screenshot({
    fullPage: options.fullPage || false,
    type: options.type || 'png',
    path: options.path,
  });
};

export const evaluate = async (page, code, args = []) => {
  return page.evaluate(code, ...args);
};

export const back = async page => page.goBack();

export const forward = async page => page.goForward();
