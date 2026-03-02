const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { createLogger } = require('./logger');
const TokenStore = require('./oauth/token-store');
const { createTokenMiddleware } = require('./oauth/token-middleware');
const createAuthorizeHandlers = require('./oauth/authorize-handler');
const createTokenHandler = require('./oauth/token-handler');
const createRevokeHandler = require('./oauth/revoke-handler');
const createWellKnownHandler = require('./fdx/well-known-handler');
const createAccountsHandler = require('./fdx/accounts-handler');
const createAccountDetailHandler = require('./fdx/account-detail-handler');
const createTransactionsHandler = require('./fdx/transactions-handler');
const createStatementsHandler = require('./fdx/statements-handler');
const createPaymentNetworksHandler = require('./fdx/payment-networks-handler');
const AccountStore = require('./data/account-store');
const UserAccountStore = require('./data/user-account-store');
const FailureInjector = require('./failure/failure-injector');
const errorMiddleware = require('./errors/error-middleware');

/**
 * Create an FDX-compliant bank server.
 *
 * @param {Object} config
 * @param {string} config.institutionId
 * @param {string} config.institutionName
 * @param {number} config.port
 * @param {boolean} [config.mfaRequired=false]
 * @param {Function} [config.setupAccounts] - (accountStore, TransactionGenerator) => void
 * @param {Object} [config.productCatalog] - { build(userId, rng, gen) } for per-user accounts
 * @param {Function} [config.setupMiddleware] - (app) => void — add custom middleware (e.g. slow response)
 */
function createFdxServer(config) {
  const {
    institutionId,
    institutionName,
    port,
    mfaRequired = false,
    setupAccounts,
    productCatalog,
    setupMiddleware,
  } = config;

  const log = createLogger(institutionId);
  const app = express();
  const tokenStore = new TokenStore(log);
  const accountStore = productCatalog
    ? new UserAccountStore(log, productCatalog, institutionId)
    : new AccountStore(log);
  const failureInjector = new FailureInjector(log);

  // Base middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev', { skip: (req) => req.path === '/health' }));
  }

  // Custom middleware (e.g. slow responses for Heritage)
  if (setupMiddleware) {
    setupMiddleware(app);
  }

  // Failure injection middleware (before auth, applies to /fdx/* only)
  app.use(failureInjector.middleware());

  // Admin routes for failure injection
  app.use('/admin', failureInjector.adminRouter());

  // Admin route for transaction injection (only for UserAccountStore)
  if (productCatalog) {
    app.post('/admin/transactions/inject', (req, res) => {
      const { userId, accountId, transaction } = req.body;
      if (!userId || !accountId || !transaction) {
        return res.status(400).json({ error: 'userId, accountId, and transaction are required' });
      }

      const { v4: uuidv4 } = require('uuid');
      const txn = {
        transactionId: transaction.transactionId || uuidv4(),
        transactionTimestamp: transaction.transactionTimestamp || new Date().toISOString(),
        description: transaction.description || 'Injected transaction',
        amount: transaction.amount || 0,
        transactionType: transaction.transactionType || 'DEBIT',
        status: 'POSTED',
        category: transaction.category || 'OTHER',
        accountId,
      };

      try {
        accountStore.injectTransaction(accountId, txn, userId);
        log.info(`Admin → injected transaction into account=${accountId} user=${userId}`);
        res.json({ status: 'injected', transaction: txn });
      } catch (err) {
        log.warn(`Admin → injection failed: ${err.message}`);
        res.status(err.httpStatus || 400).json({ error: err.message });
      }
    });
  }

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', institution: institutionId, timestamp: new Date().toISOString() });
  });

  // FDX discovery
  const baseUrl = config.baseUrl || process.env.BASE_URL || `http://localhost:${port}`;
  app.get('/.well-known/fdx-configuration', createWellKnownHandler({ institutionId, institutionName, baseUrl, log }));

  // OAuth routes
  const authorizeHandlers = createAuthorizeHandlers(tokenStore, { institutionName, mfaRequired, log });
  app.get('/oauth/authorize', authorizeHandlers.getAuthorize);
  app.post('/oauth/authorize', authorizeHandlers.postAuthorize);
  if (mfaRequired) {
    app.post('/oauth/authorize/mfa', authorizeHandlers.postMfa);
  }
  app.post('/oauth/token', createTokenHandler(tokenStore, log));
  app.post('/oauth/revoke', createRevokeHandler(tokenStore, log));

  // FDX v6 routes (all require auth)
  const auth = createTokenMiddleware(tokenStore, log);
  app.use('/fdx/v6/accounts', failureInjector.responseTransform());
  app.get('/fdx/v6/accounts', auth, ...createAccountsHandler(accountStore, log));
  app.get('/fdx/v6/accounts/:accountId', auth, ...createAccountDetailHandler(accountStore, log));
  app.get('/fdx/v6/accounts/:accountId/transactions', auth, ...createTransactionsHandler(accountStore, log));
  app.get('/fdx/v6/accounts/:accountId/statements', auth, ...createStatementsHandler(accountStore, log));
  app.get('/fdx/v6/accounts/:accountId/payment-networks', auth, ...createPaymentNetworksHandler(accountStore, log));

  // Error handler (must be last)
  app.use(errorMiddleware(log));

  // Populate accounts
  if (setupAccounts) {
    const TransactionGenerator = require('./data/transaction-generator');
    setupAccounts(accountStore, TransactionGenerator);
  }

  log.info(`Server configured: mfa=${mfaRequired}, baseUrl=${baseUrl}`);

  return {
    app,
    tokenStore,
    accountStore,
    failureInjector,
    log,
    start() {
      return new Promise(resolve => {
        const server = app.listen(port, () => {
          log.info(`${institutionName} (${institutionId}) listening on port ${port}`);
          resolve(server);
        });
      });
    },
  };
}

module.exports = createFdxServer;
