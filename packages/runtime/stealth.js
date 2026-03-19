import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import UserAgentOverride from 'puppeteer-extra-plugin-stealth/evasions/user-agent-override/index.js';
import NavigatorVendor from 'puppeteer-extra-plugin-stealth/evasions/navigator.vendor/index.js';
import NavigatorHardwareConcurrency from 'puppeteer-extra-plugin-stealth/evasions/navigator.hardwareConcurrency/index.js';
import NavigatorLanguages from 'puppeteer-extra-plugin-stealth/evasions/navigator.languages/index.js';
import WebGLVendor from 'puppeteer-extra-plugin-stealth/evasions/webgl.vendor/index.js';
import { getConfig } from './config.js';
import { log, logDebug } from './logger.js';

const CONFIGURABLE_EVASIONS = [
  'user-agent-override',
  'navigator.vendor',
  'navigator.hardwareConcurrency',
  'navigator.languages',
  'webgl.vendor',
];

export const enhanceWithStealth = (browser, presetConfig = {}) => {
  log('Initializing puppeteer-extra-plugin-stealth');
  const STEALTH_CONFIG = getConfig().stealth;

  try {
    const enhanced = addExtra(browser);
    const stealth = StealthPlugin();

    for (const name of CONFIGURABLE_EVASIONS) {
      stealth.enabledEvasions.delete(name);
    }
    stealth.enabledEvasions.delete('user-data-dir');

    for (const [name, enabled] of Object.entries(STEALTH_CONFIG.evasions)) {
      if (enabled) {
        stealth.enabledEvasions.add(name);
      } else {
        stealth.enabledEvasions.delete(name);
      }
    }

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
        UserAgentOverride({
          userAgent: userAgentArg,
          locale: localeArg,
          maskLinux: maskLinux,
        })
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

      let maskLinux;
      if (uaConfig.mask_linux != null) {
        maskLinux = uaConfig.mask_linux;
      } else {
        maskLinux = true;
      }

      let platform;
      let extPlatform;
      let platformVersion;
      if (ua.includes('Mac OS X')) {
        platform = 'MacIntel';
        extPlatform = 'Mac OS X';
        const macMatch = ua.match(/Mac OS X ([^)]+)/);
        if (macMatch) {
          platformVersion = macMatch[1];
        } else {
          platformVersion = '10_15_7';
        }
      } else if (ua.includes('Android')) {
        platform = 'Android';
        extPlatform = 'Android';
        const andMatch = ua.match(/Android ([^;]+)/);
        if (andMatch) {
          platformVersion = andMatch[1];
        } else {
          platformVersion = '14';
        }
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
          platform: extPlatform,
          platformVersion,
          architecture: 'x86',
          model: '',
          mobile: false,
          bitness: '64',
        },
      });

      const brandsJson = JSON.stringify(brands);
      const fullVersion = uaVersion;
      await page.addInitScript(`
(function() {
  const _brands = ${brandsJson};
  const _uad = {
    brands: _brands,
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues: async (hints) => {
      const result = {};
      if (hints.includes('brands')) result.brands = _brands;
      if (hints.includes('mobile')) result.mobile = false;
      if (hints.includes('platform')) result.platform = 'Windows';
      if (hints.includes('platformVersion')) result.platformVersion = '10.0.0';
      if (hints.includes('architecture')) result.architecture = 'x86';
      if (hints.includes('bitness')) result.bitness = '64';
      if (hints.includes('model')) result.model = '';
      if (hints.includes('uaFullVersion')) result.uaFullVersion = ${JSON.stringify(fullVersion)};
      if (hints.includes('fullVersionList')) result.fullVersionList = _brands.map(b => ({ brand: b.brand, version: b.version + '.0.0.0' }));
      return result;
    },
    toJSON: () => ({ brands: _brands, mobile: false, platform: 'Windows' }),
  };
  try {
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => _uad, configurable: true });
  } catch(e) {}
})();`);
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
