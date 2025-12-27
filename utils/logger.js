const LOG_LEVEL = process.env.LOG_LEVEL || 'info'

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
}

const shouldLog = level => levels[level] <= levels[LOG_LEVEL]

const format = (level, msg, meta) => {
    const timestamp = new Date().toISOString()
    const base = { timestamp, level, msg }
    return JSON.stringify(meta ? { ...base, ...meta } : base)
}

export const log = (msg, meta) => {
    if (shouldLog('info')) {
        console.error(format('info', msg, meta))
    }
}

export const logError = (msg, err, meta) => {
    if (shouldLog('error')) {
        console.error(
            format('error', msg, {
                error: err?.message || String(err),
                stack: err?.stack,
                ...meta,
            })
        )
    }
}

export const logDebug = (msg, meta) => {
    if (shouldLog('debug')) {
        console.error(format('debug', msg, meta))
    }
}

export const logWarn = (msg, meta) => {
    if (shouldLog('warn')) {
        console.error(format('warn', msg, meta))
    }
}