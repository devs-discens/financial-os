const FdxError = require('../errors/fdx-error');
const { FDX_ERROR_CODES } = require('../constants');

class FailureInjector {
  constructor(log) {
    this.log = log || { debug() {}, info() {}, warn() {}, error() {} };
    this.failures = new Map(); // type -> config
  }

  // Middleware that checks for active failures before FDX requests
  middleware() {
    return (req, res, next) => {
      // Only apply to FDX endpoints
      if (!req.path.startsWith('/fdx/')) return next();

      for (const [type, config] of this.failures) {
        const triggered = this._check(type, config, req, res);
        if (triggered) return;
      }
      next();
    };
  }

  set(type, config = {}) {
    this.failures.set(type, { ...config, activatedAt: Date.now() });
    this.log.info(`FailureInjector → activated type=${type} config=${JSON.stringify(config)}`);
  }

  clear(type) {
    if (type) {
      this.failures.delete(type);
      this.log.info(`FailureInjector → cleared type=${type}`);
    } else {
      this.failures.clear();
      this.log.info(`FailureInjector → all failures cleared`);
    }
  }

  list() {
    const result = {};
    for (const [type, config] of this.failures) {
      result[type] = config;
    }
    return result;
  }

  _check(type, config, req, res) {
    // Rate-based triggering: config.rate = 0.0 to 1.0
    const rate = config.rate ?? 1.0;
    if (Math.random() > rate) return false;

    switch (type) {
      case 'rate-limit':
        this.log.warn(`FailureInjector ← triggered rate-limit on ${req.method} ${req.path}`);
        res.set('Retry-After', String(config.retryAfter || 60));
        res.status(429).json(new FdxError(FDX_ERROR_CODES.TOO_MANY_REQUESTS, 'Rate limit exceeded').toJSON());
        return true;

      case 'transient-error':
        this.log.warn(`FailureInjector ← triggered transient-error on ${req.method} ${req.path}`);
        res.status(500).json(new FdxError(500, 'Internal server error', 'Simulated transient failure').toJSON());
        return true;

      case 'slow-response':
        // Delay only — don't short-circuit, let request continue after delay
        return false;

      case 'token-expiry':
        this.log.warn(`FailureInjector ← triggered token-expiry on ${req.method} ${req.path}`);
        res.status(401).json(new FdxError(FDX_ERROR_CODES.UNAUTHORIZED, 'Token expired').toJSON());
        return true;

      case 'schema-change':
        // Will be handled by response transform in the middleware
        return false;

      case 'outage':
        this.log.warn(`FailureInjector ← triggered outage on ${req.method} ${req.path}`);
        res.status(503).json({ code: 503, message: 'Service temporarily unavailable' });
        return true;

      case 'consent-revoked':
        this.log.warn(`FailureInjector ← triggered consent-revoked on ${req.method} ${req.path}`);
        res.status(403).json(new FdxError(FDX_ERROR_CODES.FORBIDDEN, 'Consent has been revoked').toJSON());
        return true;

      case 'anomalous-balance':
        // Will be handled by response transform
        return false;

      default:
        return false;
    }
  }

  // Response transform middleware for non-blocking failure types
  // Wraps res.json() to modify account balance data before sending
  // Must be mounted on the accounts path: app.use('/fdx/v6/accounts', fi.responseTransform())
  responseTransform() {
    return (req, res, next) => {
      const config = this.failures.get('anomalous-balance');
      if (!config) return next();

      const rate = config.rate ?? 1.0;
      if (Math.random() > rate) return next();

      const origJson = res.json.bind(res);
      res.json = (body) => {
        if (body && body.accounts && Array.isArray(body.accounts)) {
          // List endpoint — pick a random account to distort
          const idx = Math.floor(Math.random() * body.accounts.length);
          body.accounts[idx] = this._distortBalance(body.accounts[idx], config);
          this.log.warn(`FailureInjector ← anomalous-balance on list (account ${body.accounts[idx].accountId})`);
        } else if (body && body.accountId) {
          // Detail endpoint — distort the single account
          body = this._distortBalance(body, config);
          this.log.warn(`FailureInjector ← anomalous-balance on detail (account ${body.accountId})`);
        }
        return origJson(body);
      };
      next();
    };
  }

  _distortBalance(account, config) {
    const multiplier = config.multiplier ?? 2.0;
    const copy = { ...account };
    for (const field of ['currentBalance', 'availableBalance', 'principalBalance']) {
      if (copy[field] != null) {
        copy[field] = +(copy[field] * multiplier).toFixed(2);
      }
    }
    return copy;
  }

  // Express admin router for controlling failures
  adminRouter() {
    const express = require('express');
    const router = express.Router();

    router.get('/failure', (req, res) => {
      res.json(this.list());
    });

    router.post('/failure/:type', express.json(), (req, res) => {
      this.set(req.params.type, req.body || {});
      res.json({ status: 'activated', type: req.params.type, config: this.failures.get(req.params.type) });
    });

    router.delete('/failure/:type', (req, res) => {
      this.clear(req.params.type);
      res.json({ status: 'cleared', type: req.params.type });
    });

    router.delete('/failure', (req, res) => {
      this.clear();
      res.json({ status: 'all_cleared' });
    });

    return router;
  }
}

module.exports = FailureInjector;
