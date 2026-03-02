const FdxError = require('../errors/fdx-error');
const { FDX_ERROR_CODES } = require('../constants');

function createTokenMiddleware(tokenStore, log) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  return function tokenMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log.debug(`Auth ← rejected: missing/invalid Authorization header for ${req.method} ${req.path}`);
      return next(new FdxError(FDX_ERROR_CODES.UNAUTHORIZED, 'Missing or invalid Authorization header'));
    }

    const token = authHeader.slice(7);
    const tokenInfo = tokenStore.validateAccessToken(token);
    if (!tokenInfo) {
      log.debug(`Auth ← rejected: invalid/expired token=${token.slice(0, 8)}... for ${req.method} ${req.path}`);
      return next(new FdxError(FDX_ERROR_CODES.UNAUTHORIZED, 'Invalid or expired access token'));
    }

    log.debug(`Auth ← ok token=${token.slice(0, 8)}... scopes=${tokenInfo.scopes} → ${req.method} ${req.path}`);
    req.tokenInfo = tokenInfo;
    next();
  };
}

function requireScope(scope) {
  return function scopeMiddleware(req, res, next) {
    if (!req.tokenInfo || !req.tokenInfo.scopes.includes(scope)) {
      return next(new FdxError(FDX_ERROR_CODES.FORBIDDEN, `Missing required scope: ${scope}`));
    }
    next();
  };
}

module.exports = { createTokenMiddleware, requireScope };
