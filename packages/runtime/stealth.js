import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import UserAgentOverride from 'puppeteer-extra-plugin-stealth/evasions/user-agent-override/index.js';
import NavigatorVendor from 'puppeteer-extra-plugin-stealth/evasions/navigator.vendor/index.js';
import NavigatorHardwareConcurrency from 'puppeteer-extra-plugin-stealth/evasions/navigator.hardwareConcurrency/index.js';
import NavigatorLanguages from 'puppeteer-extra-plugin-stealth/evasions/navigator.languages/index.js';
import WebGLVendor from 'puppeteer-extra-plugin-stealth/evasions/webgl.vendor/index.js';
import { getConfig } from './config.js';
import { log, logDebug } from './logger.js';
import { greasedBrands, chromeMajor, chromeFullVersion } from './stealth-evasions/ua-brands.js';

const CONFIGURABLE_EVASIONS = [
  'user-agent-override',
  'navigator.vendor',
  'navigator.hardwareConcurrency',
  'navigator.languages',
  'webgl.vendor',
];

// puppeteer-extra-plugin-stealth user-agent-override ends onPageCreated with
// page._client().send(...) and drops the promise (no await, index.js:182). When
// the page closes first, that rejection is unhandled: it fails the Playwright
// test worker (direct rebrowser.spec.js run) and would exit a Node process.
// The guarded page hands the plugin a client whose send never rejects.
const rawClient = page => {
  if (typeof page._client === 'function') return page._client();
  return page._client;
};

// Names the page in the skip log, so a host run shows which page raced.
// Runs inside guardedClient's catch, so it must never throw.
const pageLabel = page => {
  if (typeof page.url !== 'function') return 'unknown page';
  try {
    return page.url() || 'unknown page';
  } catch {
    return 'unknown page';
  }
};

// The plugin builds its own brand list; swap in szkrabok's
// (stealth-evasions/ua-brands.js).
const withGreasedBrands = (method, params) => {
  if (method !== 'Network.setUserAgentOverride' || !params?.userAgentMetadata) return params;
  const major = chromeMajor(params?.userAgent);
  if (major === null) return params;
  const fullVersion = chromeFullVersion(params.userAgent);
  return {
    ...params,
    userAgentMetadata: {
      ...params.userAgentMetadata,
      brands: greasedBrands(major),
      fullVersionList: greasedBrands(major, fullVersion),
      fullVersion,
      bitness: '64',
    },
  };
};

const guardedClient = (client, label) => ({
  send: async (method, params) => {
    try {
      return await client.send(method, withGreasedBrands(method, params));
    } catch (err) {
      log(`user-agent-override: ${method} skipped on ${label()}: ${err.message}`);
      return undefined;
    }
  },
  on: (event, listener) => client.on(event, listener),
});

const guardedPage = page =>
  new Proxy(page, {
    get: (target, prop) => {
      if (prop === '_client') return () => guardedClient(rawClient(target), () => pageLabel(target));
      const value = Reflect.get(target, prop);
      if (typeof value !== 'function') return value;
      return value.bind(target);
    },
  });

// Must stay `async`: playwright-extra only attaches .catch(onPluginError) to
// hooks whose constructor is AsyncFunction. Sync throws are caught either way;
// a plain wrapper returning the inner promise would leave its rejection
// unhandled.
export const guardUserAgentPlugin = plugin => {
  const onPageCreated = plugin.onPageCreated.bind(plugin);
  plugin.onPageCreated = async page => onPageCreated(guardedPage(page));
  return plugin;
};

// user-agent-override depends on user-preferences, which depends on
// puppeteer-extra-plugin-user-data-dir. That pair is Puppeteer-only: under
// launchPersistentContext the plugin never sees the real profile, so it makes a
// /tmp/puppeteer_dev_profile-* dir per launch and writes a Preferences file
// Chrome never reads (only intl.accept_languages, which Playwright's `locale`
// already sets). playwright-extra skips a dependency whose name is taken, so
// this hook-less stub keeps both out.
export const USER_PREFERENCES_STUB = Object.freeze({
  _isPuppeteerExtraPlugin: true,
  name: 'user-preferences',
});

export const enhanceWithStealth = (browser, presetConfig = {}) => {
  log('Initializing puppeteer-extra-plugin-stealth');
  const STEALTH_CONFIG = getConfig().stealth;

  try {
    const enhanced = addExtra(browser);
    enhanced.use(USER_PREFERENCES_STUB);
    const stealth = StealthPlugin();

    for (const name of CONFIGURABLE_EVASIONS) {
      stealth.enabledEvasions.delete(name);
    }

    for (const [name, enabled] of Object.entries(STEALTH_CONFIG.evasions)) {
      if (enabled) {
        stealth.enabledEvasions.add(name);
      } else {
        stealth.enabledEvasions.delete(name);
      }
    }

    // Removed after the config loop, so no `evasions` entry can re-add them.
    // user-data-dir: permanently disabled (conflicts with szkrabok's own
    // profile dirs, see szkrabok.config.toml). user-agent-override: only ever
    // added below, guarded; an entry would load an unguarded copy
    // (guardUserAgentPlugin above).
    stealth.enabledEvasions.delete('user-data-dir');
    stealth.enabledEvasions.delete('user-agent-override');

    enhanced.use(stealth);

    const uaConfig = STEALTH_CONFIG['user-agent-override'];
    let overrideUA;
    if (presetConfig.overrideUserAgent != null) {
      overrideUA = presetConfig.overrideUserAgent;
    } else if (uaConfig.enabled != null) {
      overrideUA = uaConfig.enabled;
    } else {
      overrideUA = true;
    }
    if (overrideUA) {
      let userAgentArg;
      if (presetConfig.userAgent) {
        userAgentArg = presetConfig.userAgent;
      } else {
        userAgentArg = undefined;
      }
      let localeArg;
      if (presetConfig.locale) {
        localeArg = presetConfig.locale;
      } else {
        localeArg = undefined;
      }
      let maskLinux;
      if (uaConfig.mask_linux != null) {
        maskLinux = uaConfig.mask_linux;
      } else {
        maskLinux = true;
      }
      enhanced.use(
        guardUserAgentPlugin(
          UserAgentOverride({
            userAgent: userAgentArg,
            locale: localeArg,
            maskLinux: maskLinux,
          })
        )
      );
    }

    const vendorConfig = STEALTH_CONFIG['navigator.vendor'];
    if (vendorConfig.enabled == null || vendorConfig.enabled) {
      let vendor;
      if (vendorConfig.vendor != null) {
        vendor = vendorConfig.vendor;
      } else {
        vendor = 'Google Inc.';
      }
      enhanced.use(NavigatorVendor({ vendor: vendor }));
    }

    const hwConfig = STEALTH_CONFIG['navigator.hardwareConcurrency'];
    if (hwConfig.enabled == null || hwConfig.enabled) {
      let hardwareConcurrency;
      if (hwConfig.hardware_concurrency != null) {
        hardwareConcurrency = hwConfig.hardware_concurrency;
      } else {
        hardwareConcurrency = 4;
      }
      enhanced.use(NavigatorHardwareConcurrency({ hardwareConcurrency: hardwareConcurrency }));
    }

    const langConfig = STEALTH_CONFIG['navigator.languages'];
    if (langConfig.enabled == null || langConfig.enabled) {
      let locale;
      if (presetConfig.locale) {
        locale = presetConfig.locale;
      } else {
        locale = 'en-US';
      }
      let languages;
      if (langConfig.languages != null) {
        languages = langConfig.languages.filter(Boolean);
      } else {
        const langBase = locale.split('-')[0];
        languages = [locale, langBase].filter(Boolean);
      }
      enhanced.use(NavigatorLanguages({ languages: languages }));
    }

    const webglConfig = STEALTH_CONFIG['webgl.vendor'];
    if (webglConfig.enabled == null || webglConfig.enabled) {
      let vendor;
      if (webglConfig.vendor != null) {
        vendor = webglConfig.vendor;
      } else {
        vendor = 'Intel Inc.';
      }
      let renderer;
      if (webglConfig.renderer != null) {
        renderer = webglConfig.renderer;
      } else {
        renderer = 'Intel Iris OpenGL Engine';
      }
      enhanced.use(
        WebGLVendor({
          vendor: vendor,
          renderer: renderer,
        })
      );
    }

    return enhanced;
  } catch (err) {
    log('Stealth plugin failed, using vanilla Playwright', err.message);
    return browser;
  }
};

export const applyStealthToExistingPage = async (page, presetConfig = {}) => {
  const STEALTH_CONFIG = getConfig().stealth;
  try {
    logDebug('applyStealthToExistingPage called', { presetConfig });
    const uaConfig = STEALTH_CONFIG['user-agent-override'];
    let overrideUA;
    if (presetConfig.overrideUserAgent != null) {
      overrideUA = presetConfig.overrideUserAgent;
    } else if (uaConfig.enabled != null) {
      overrideUA = uaConfig.enabled;
    } else {
      overrideUA = true;
    }
    const hwConfig = STEALTH_CONFIG['navigator.hardwareConcurrency'];
    const webglConfig = STEALTH_CONFIG['webgl.vendor'];
    const langConfig = STEALTH_CONFIG['navigator.languages'];

    const client = await page.context().newCDPSession(page);

    if (overrideUA) {
      let ua;
      if (presetConfig.userAgent) {
        ua = presetConfig.userAgent;
      } else {
        ua = '';
      }
      const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
      let uaVersion;
      if (chromeMatch) {
        uaVersion = chromeMatch[1];
      } else {
        uaVersion = '120.0.0.0';
      }
      const seed = parseInt(uaVersion.split('.')[0]);

      const brands = greasedBrands(seed);

      let maskLinux;
      if (uaConfig.mask_linux != null) {
        maskLinux = uaConfig.mask_linux;
      } else {
        maskLinux = true;
      }

      let platform;
      let extPlatform;
      let platformVersion;
      let architecture = 'x86';
      let model = '';
      if (ua.includes('Mac OS X')) {
        platform = 'MacIntel';
        extPlatform = 'Mac OS X';
        const macMatch = ua.match(/Mac OS X ([^)]+)/);
        if (macMatch) {
          platformVersion = macMatch[1];
        } else {
          platformVersion = '10_15_7';
        }
        if (!ua.includes('Intel')) architecture = 'arm';
      } else if (ua.includes('Android')) {
        platform = 'Android';
        extPlatform = 'Android';
        const andMatch = ua.match(/Android ([^;]+)/);
        if (andMatch) {
          platformVersion = andMatch[1];
        } else {
          platformVersion = '14';
        }
        architecture = 'arm';
        const modelMatch = ua.match(/Android[^;]*;\s*([^)]+)/);
        if (modelMatch) model = modelMatch[1].trim();
      } else if (ua.includes('Linux') && !maskLinux) {
        platform = 'Linux x86_64';
        extPlatform = 'Linux';
        platformVersion = '';
      } else {
        platform = 'Win32';
        extPlatform = 'Windows';
        platformVersion = '10.0';
      }

      let locale;
      if (presetConfig.locale) {
        locale = presetConfig.locale;
      } else {
        locale = 'en-US';
      }

      await client.send('Network.setUserAgentOverride', {
        userAgent: ua,
        acceptLanguage: `${locale},${locale.split('-')[0]};q=0.9`,
        platform,
        userAgentMetadata: {
          brands,
          fullVersion: uaVersion,
          fullVersionList: greasedBrands(seed, uaVersion),
          platform: extPlatform,
          platformVersion,
          architecture,
          model,
          mobile: platform === 'Android',
          bitness: '64',
        },
      });
    }

    if (hwConfig.enabled == null || hwConfig.enabled) {
      let concurrency;
      if (hwConfig.hardware_concurrency != null) {
        concurrency = hwConfig.hardware_concurrency;
      } else {
        concurrency = 4;
      }
      logDebug('registering hardwareConcurrency init script', { concurrency });
      await page.addInitScript(`(function(){
  try {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => ${concurrency}, configurable: true });
  } catch(e) {}
})()`);
    }

    if (langConfig.enabled == null || langConfig.enabled) {
      let locale;
      if (presetConfig.locale) {
        locale = presetConfig.locale;
      } else {
        locale = 'en-US';
      }
      let languages;
      if (langConfig.languages != null) {
        languages = langConfig.languages.filter(Boolean);
      } else {
        const langBase = locale.split('-')[0];
        languages = [locale, langBase].filter(Boolean);
      }
      const langsJson = JSON.stringify(languages);
      await page.addInitScript(
        `Object.defineProperty(Navigator.prototype, 'languages', { get: () => ${langsJson}, configurable: true });`
      );
    }

    if (webglConfig.enabled == null || webglConfig.enabled) {
      let vendor;
      if (webglConfig.vendor != null) {
        vendor = webglConfig.vendor;
      } else {
        vendor = 'Intel Inc.';
      }
      let renderer;
      if (webglConfig.renderer != null) {
        renderer = webglConfig.renderer;
      } else {
        renderer = 'Intel Iris OpenGL Engine';
      }
      await page.addInitScript(`
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
})()`);
    }

    log('Applied stealth evasions to existing page via CDP');
  } catch (err) {
    log('applyStealthToExistingPage failed', err.message);
  }
};
