const FdxError = require('./fdx-error');

function errorMiddleware(log) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  return function errorHandler(err, req, res, _next) {
    if (err instanceof FdxError) {
      log.debug(`Error ← FdxError code=${err.code} message="${err.message}" → ${req.method} ${req.path}`);
      return res.status(err.httpStatus).json(err.toJSON());
    }

    log.error(`Error ← unhandled: ${err.message} → ${req.method} ${req.path}`, err.stack);
    res.status(500).json({
      code: 500,
      message: 'Internal server error',
      debugMessage: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  };
}

module.exports = errorMiddleware;
