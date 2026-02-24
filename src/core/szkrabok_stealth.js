import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// Individual evasion plugins — imported directly to allow passing options.
// The bundled StealthPlugin cannot pass opts to individual evasions.
import UserAgentOverride from 'puppeteer-extra-plugin-stealth/evasions/user-agent-override/index.js';
import NavigatorVendor from 'puppeteer-extra-plugin-stealth/evasions/navigator.vendor/index.js';
import NavigatorHardwareConcurrency from 'puppeteer-extra-plugin-stealth/evasions/navigator.hardwareConcurrency/index.js';
import NavigatorLanguages from 'puppeteer-extra-plugin-stealth/evasions/navigator.languages/index.js';
import WebGLVendor from 'puppeteer-extra-plugin-stealth/evasions/webgl.vendor/index.js';
import { STEALTH_CONFIG } from '../config.js';
import { log } from '../utils/logger.js';

// Evasions handled via individual plugins with options — must be removed from
// the bundled StealthPlugin to avoid running twice.
const CONFIGURABLE_EVASIONS = [
  'user-agent-override',
  'navigator.vendor',
  'navigator.hardwareConcurrency',
  'navigator.languages',
  'webgl.vendor',
];

// enhanceWithStealth(browser, presetConfig)
//
// presetConfig — resolved preset from szkrabok_session.js:
//   { userAgent, locale, overrideUserAgent }
//
// When user-agent-override evasion is enabled, userAgent and locale from the
// preset are passed as opts so the evasion stays in sync with the identity.
// When overrideUserAgent = false, user-agent-override is disabled regardless
// of TOML — the browser reports its real Chromium UA.
export const enhanceWithStealth = (browser, presetConfig = {}) => {
  log('Initializing puppeteer-extra-plugin-stealth');

  try {
    const enhanced = addExtra(browser);
    const stealth = StealthPlugin();

    // ── Simple evasions (no options) ───────────────────────────────────────
    // Apply the flat boolean map from [puppeteer-extra-plugin-stealth.evasions].
    // Start from the plugin's default set, then apply TOML overrides.

    // Remove configurable evasions — they are added individually below with opts
    for (const name of CONFIGURABLE_EVASIONS) {
      stealth.enabledEvasions.delete(name);
    }

    // user-data-dir: always disabled — conflicts with szkrabok persistent profiles
    stealth.enabledEvasions.delete('user-data-dir');

    // Apply TOML enabled/disabled for simple evasions
    for (const [name, enabled] of Object.entries(STEALTH_CONFIG.evasions)) {
      if (enabled) {
        stealth.enabledEvasions.add(name);
      } else {
        stealth.enabledEvasions.delete(name);
      }
    }

    enhanced.use(stealth);

    // ── Configurable evasions (with options) ───────────────────────────────
    // Each is added as an individual plugin so options can be passed.
    // Evasion is skipped entirely when enabled = false in TOML.

    // user-agent-override
    // Controlled by both TOML and per-session overrideUserAgent flag.
    // presetConfig.overrideUserAgent = false disables UA spoofing for this session.
    const uaConfig = STEALTH_CONFIG['user-agent-override'];
    const overrideUA = presetConfig.overrideUserAgent ?? uaConfig.enabled ?? true;
    if (overrideUA) {
      enhanced.use(
        UserAgentOverride({
          // userAgent and locale come from the active preset — kept in sync
          // with navigator.userAgentData, navigator.platform, Accept-Language
          userAgent: presetConfig.userAgent || undefined,
          locale: presetConfig.locale || undefined,
          maskLinux: uaConfig.mask_linux ?? true,
        })
      );
    }

    // navigator.vendor
    const vendorConfig = STEALTH_CONFIG['navigator.vendor'];
    if (vendorConfig.enabled ?? true) {
      enhanced.use(NavigatorVendor({ vendor: vendorConfig.vendor ?? 'Google Inc.' }));
    }

    // navigator.hardwareConcurrency
    const hwConfig = STEALTH_CONFIG['navigator.hardwareConcurrency'];
    if (hwConfig.enabled ?? true) {
      enhanced.use(
        NavigatorHardwareConcurrency({
          hardwareConcurrency: hwConfig.hardware_concurrency ?? 4,
        })
      );
    }

    // navigator.languages
    // Derive from preset locale when no explicit override in TOML.
    const langConfig = STEALTH_CONFIG['navigator.languages'];
    if (langConfig.enabled ?? true) {
      const locale = presetConfig.locale || 'en-US';
      const languages = langConfig.languages ?? [locale, locale.split('-')[0]].filter(Boolean);
      enhanced.use(NavigatorLanguages({ languages }));
    }

    // webgl.vendor
    const webglConfig = STEALTH_CONFIG['webgl.vendor'];
    if (webglConfig.enabled ?? true) {
      enhanced.use(
        WebGLVendor({
          vendor: webglConfig.vendor ?? 'Intel Inc.',
          renderer: webglConfig.renderer ?? 'Intel Iris OpenGL Engine',
        })
      );
    }

    return enhanced;
  } catch (err) {
    log('Stealth plugin failed, using vanilla Playwright', err.message);
    return browser;
  }
};

// applyStealthToExistingPage(page, presetConfig)
//
// Option B workaround for launchPersistentContext: playwright-extra's onPageCreated
// never fires for the initial page, so evasions that use init scripts or CDP calls
// miss it entirely. This function manually applies those evasions via a CDP session
// attached to the existing page BEFORE any real navigation.
//
// Uses only public Playwright APIs (page.context().newCDPSession) and stable CDP
// commands (Network.setUserAgentOverride, Page.addScriptToEvaluateOnNewDocument).
//
// Network.setUserAgentOverride — applies to all network requests from this page.
// Page.addScriptToEvaluateOnNewDocument — runs before page JS on every future navigation.
//
// See docs/launchpersistentcontext-stealth-issue.md
export const applyStealthToExistingPage = async (page, presetConfig = {}) => {
  try {
    const uaConfig = STEALTH_CONFIG['user-agent-override'];
    const overrideUA = presetConfig.overrideUserAgent ?? uaConfig.enabled ?? true;
    const hwConfig = STEALTH_CONFIG['navigator.hardwareConcurrency'];
    const webglConfig = STEALTH_CONFIG['webgl.vendor'];
    const langConfig = STEALTH_CONFIG['navigator.languages'];

    const client = await page.context().newCDPSession(page);

    // ── user-agent-override ─────────────────────────────────────────────────
    // Replicates what the evasion does in onPageCreated: sets the full UA bundle
    // (userAgent, platform, userAgentMetadata) consistently via CDP so
    // navigator.userAgent and navigator.userAgentData report matching values.
    if (overrideUA) {
      const ua = presetConfig.userAgent || '';
      const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
      const uaVersion = chromeMatch ? chromeMatch[1] : '120.0.0.0';
      const seed = parseInt(uaVersion.split('.')[0]);

      // Greasy brand algorithm — same as puppeteer-extra-plugin-stealth.
      // Randomises brand order based on Chrome major version to avoid
      // a static fingerprint on the brands list itself.
      const order = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ][seed % 6];
      const escapedChars = [' ', ' ', ';'];
      const greaseyBrand = `${escapedChars[order[0]]}Not${escapedChars[order[1]]}A${escapedChars[order[2]]}Brand`;
      const brands = [];
      brands[order[0]] = { brand: greaseyBrand, version: '99' };
      brands[order[1]] = { brand: 'Chromium', version: String(seed) };
      brands[order[2]] = { brand: 'Google Chrome', version: String(seed) };

      // Derive platform from UA string — same logic as the evasion plugin.
      const maskLinux = uaConfig.mask_linux ?? true;
      let platform = 'Win32';
      let extPlatform = 'Windows';
      let platformVersion = '10.0';
      if (ua.includes('Mac OS X')) {
        platform = 'MacIntel';
        extPlatform = 'Mac OS X';
        const macMatch = ua.match(/Mac OS X ([^)]+)/);
        platformVersion = macMatch ? macMatch[1] : '10_15_7';
      } else if (ua.includes('Android')) {
        platform = 'Android';
        extPlatform = 'Android';
        const andMatch = ua.match(/Android ([^;]+)/);
        platformVersion = andMatch ? andMatch[1] : '14';
      } else if (ua.includes('Linux') && !maskLinux) {
        platform = 'Linux x86_64';
        extPlatform = 'Linux';
        platformVersion = '';
      }
      // Linux + maskLinux=true (default) stays as Win32/Windows above.

      const locale = presetConfig.locale || 'en-US';

      await client.send('Network.setUserAgentOverride', {
        userAgent: ua,
        acceptLanguage: `${locale},${locale.split('-')[0]};q=0.9`,
        platform,
        userAgentMetadata: {
          brands,
          fullVersion: uaVersion,
          platform: extPlatform,
          platformVersion,
          architecture: 'x86',
          model: '',
          mobile: false,
          bitness: '64',
        },
      });
    }

    // ── navigator.hardwareConcurrency ───────────────────────────────────────
    // Page.addScriptToEvaluateOnNewDocument runs before page JS on every future
    // navigation of this page — equivalent to page.addInitScript() but via CDP.
    if (hwConfig.enabled ?? true) {
      const concurrency = hwConfig.hardware_concurrency ?? 4;
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${concurrency} });`,
      });
    }

    // ── navigator.languages ─────────────────────────────────────────────────
    if (langConfig.enabled ?? true) {
      const locale = presetConfig.locale || 'en-US';
      const languages = langConfig.languages ?? [locale, locale.split('-')[0]].filter(Boolean);
      const langsJson = JSON.stringify(languages);
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `Object.defineProperty(navigator, 'languages', { get: () => ${langsJson} });`,
      });
    }

    // ── webgl.vendor ────────────────────────────────────────────────────────
    if (webglConfig.enabled ?? true) {
      const vendor = webglConfig.vendor ?? 'Intel Inc.';
      const renderer = webglConfig.renderer ?? 'Intel Iris OpenGL Engine';
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
(function() {
  const _getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(p) {
    if (p === 37445) return ${JSON.stringify(vendor)};
    if (p === 37446) return ${JSON.stringify(renderer)};
    return _getParameter.call(this, p);
  };
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const _get2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return ${JSON.stringify(vendor)};
      if (p === 37446) return ${JSON.stringify(renderer)};
      return _get2.call(this, p);
    };
  }
})();`,
      });
    }

    // Do NOT detach — Network.setUserAgentOverride and
    // Page.addScriptToEvaluateOnNewDocument are scoped to the CDP session.
    // Detaching removes the overrides. Chrome cleans up when the page closes.
    log('Applied stealth evasions to existing page via CDP');
  } catch (err) {
    log('applyStealthToExistingPage failed', err.message);
  }
};
