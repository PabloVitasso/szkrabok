export class SessionNotFoundError extends Error {
  constructor(id, customMessage = null) {
    super(customMessage || `Session not found: ${id}`)
    this.name = 'SessionNotFoundError'
    this.code = 'SESSION_NOT_FOUND'
    this.sessionId = id
  }
}

export class SessionExistsError extends Error {
  constructor(id) {
    super(`Session already exists: ${id}`)
    this.name = 'SessionExistsError'
    this.code = 'SESSION_EXISTS'
    this.sessionId = id
  }
}

export class ValidationError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'ValidationError'
    this.code = 'VALIDATION_ERROR'
    this.field = field
  }
}

export const wrapError = err => {
  if (err.code) return err

  return {
    code: 'UNKNOWN_ERROR',
    message: err.message || String(err),
    stack: err.stack,
  }
}
