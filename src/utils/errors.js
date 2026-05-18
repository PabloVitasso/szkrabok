export { SessionNotFoundError } from '#runtime';

export class SessionExistsError extends Error {
  constructor(id) {
    super(`Session already exists: ${id}`);
    this.name = 'SessionExistsError';
    this.code = 'SESSION_EXISTS';
    this.sessionId = id;
  }
}

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
    this.field = field;
  }
}

export const wrapError = err => {
  if (typeof err.toJSON === 'function') return err.toJSON();
  if (err.code) {
    return {
      code: err.code,
      message: err.message,
      ...(err.hint && { hint: err.hint }),
      ...(err.restartNeeded && { restartNeeded: true }),
      ...(err.context && { context: err.context }),
      ...(err.sessionId && { sessionId: err.sessionId }),
    };
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: err.message || String(err),
    stack: err.stack,
  };
};
