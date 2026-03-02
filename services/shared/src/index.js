const createFdxServer = require('./fdx-server');
const TransactionGenerator = require('./data/transaction-generator');
const AccountStore = require('./data/account-store');
const TokenStore = require('./oauth/token-store');
const FailureInjector = require('./failure/failure-injector');
const FdxError = require('./errors/fdx-error');
const constants = require('./constants');
const { paginate, extractPaginationParams } = require('./pagination');
const { MERCHANTS, getMerchantsByCategory, getAllCategories } = require('./merchants');
const { createLogger } = require('./logger');

module.exports = {
  createFdxServer,
  TransactionGenerator,
  AccountStore,
  TokenStore,
  FailureInjector,
  FdxError,
  constants,
  paginate,
  extractPaginationParams,
  MERCHANTS,
  getMerchantsByCategory,
  getAllCategories,
  createLogger,
};
