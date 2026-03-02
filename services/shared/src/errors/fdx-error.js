class FdxError extends Error {
  constructor(code, message, debugMessage = null) {
    super(message);
    this.name = 'FdxError';
    this.code = code;
    this.debugMessage = debugMessage;
  }

  toJSON() {
    const body = { code: this.code, message: this.message };
    if (this.debugMessage) body.debugMessage = this.debugMessage;
    return body;
  }

  get httpStatus() {
    if (this.code === 429) return 429;
    if (this.code === 401) return 401;
    if (this.code === 403) return 403;
    if (this.code >= 600 && this.code < 700) return 404;
    if (this.code >= 700 && this.code < 800) return 404;
    return 500;
  }
}

module.exports = FdxError;
