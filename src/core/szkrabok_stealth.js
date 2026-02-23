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
