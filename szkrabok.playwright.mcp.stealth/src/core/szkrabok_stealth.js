import { addExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { log } from '../utils/logger.js'

let stealthInitialized = false

export const enhanceWithStealth = browser => {
  if (!stealthInitialized) {
    log('Initializing stealth plugin')
    stealthInitialized = true
  }

  try {
    const enhanced = addExtra(browser)
    const stealth = StealthPlugin()

    // Disable conflicting evasions
    stealth.enabledEvasions.delete('user-data-dir')

    // Enable all other evasions explicitly
    stealth.enabledEvasions.add('chrome.app')
    stealth.enabledEvasions.add('chrome.csi')
    stealth.enabledEvasions.add('chrome.loadTimes')
    stealth.enabledEvasions.add('chrome.runtime')
    stealth.enabledEvasions.add('iframe.contentWindow')
    stealth.enabledEvasions.add('media.codecs')
    stealth.enabledEvasions.add('navigator.hardwareConcurrency')
    stealth.enabledEvasions.add('navigator.languages')
    stealth.enabledEvasions.add('navigator.permissions')
    stealth.enabledEvasions.add('navigator.plugins')
    stealth.enabledEvasions.add('navigator.vendor')
    stealth.enabledEvasions.add('navigator.webdriver')
    stealth.enabledEvasions.add('window.outerdimensions')

    enhanced.use(stealth)
    return enhanced
  } catch (err) {
    log('Stealth plugin failed, using vanilla Playwright', err.message)
    return browser
  }
}