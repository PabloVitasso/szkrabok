import { homedir } from 'os'
import { join } from 'path'
import { readdirSync, existsSync } from 'fs'

const DEFAULT_TIMEOUT = 30000

export const TIMEOUT = parseInt(process.env.TIMEOUT) || DEFAULT_TIMEOUT

export const HEADLESS = process.env.HEADLESS === 'true'

export const DISABLE_WEBGL = process.env.DISABLE_WEBGL === 'true'

export const VIEWPORT = {
    width: parseInt(process.env.VIEWPORT_WIDTH) || 1280,
    height: parseInt(process.env.VIEWPORT_HEIGHT) || 800,
}

export const USER_AGENT =
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const LOCALE = process.env.LOCALE || 'en-US'

export const TIMEZONE = process.env.TIMEZONE || 'America/New_York'

export const findChromiumPath = () => {
    const playwrightCache = join(homedir(), '.cache', 'ms-playwright')

    if (!existsSync(playwrightCache)) {
        return null
    }

    const dirs = readdirSync(playwrightCache)
        .filter(d => d.startsWith('chromium-'))
        .sort()
        .reverse() // latest first

    for (const dir of dirs) {
        const paths = [
            join(playwrightCache, dir, 'chrome-linux', 'chrome'),
            join(playwrightCache, dir, 'chrome-linux64', 'chrome'),
        ]

        for (const path of paths) {
            if (existsSync(path)) {
                return path
            }
        }
    }

    return null
}