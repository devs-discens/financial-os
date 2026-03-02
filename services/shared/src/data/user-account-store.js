const seedrandom = require('seedrandom');
const { FDX_ERROR_CODES } = require('../constants');
const FdxError = require('../errors/fdx-error');
const TransactionGenerator = require('./transaction-generator');

/**
 * Per-user account store. Lazily builds accounts for each userId
 * using a product catalog and seeded RNG for deterministic data.
 *
 * Method signatures are compatible with AccountStore — userId is always
 * the LAST parameter so handlers can pass it uniformly and AccountStore
 * simply ignores the extra argument.
 */
class UserAccountStore {
  constructor(log, productCatalog, institutionId) {
    this.log = log || { debug() {}, info() {}, warn() {}, error() {} };
    this.productCatalog = productCatalog;
    this.institutionId = institutionId;
    this.userCache = new Map(); // userId -> { accounts, transactions, statements }
  }

  /**
   * Get or build the data set for a user. Lazily initializes on first access.
   */
  getOrBuildUser(userId) {
    if (!userId) userId = 'alex-chen';
    if (this.userCache.has(userId)) return this.userCache.get(userId);

    const seed = `${this.institutionId}-${userId}`;
    const rng = seedrandom(seed);
    const gen = new TransactionGenerator(seed);

    const result = this.productCatalog.build(userId, rng, gen);
    this.userCache.set(userId, result);
    this.log.debug(`UserAccountStore → built user=${userId} accounts=${result.accounts.size}`);
    return result;
  }

  // Compatible with AccountStore.listAccounts() — userId is extra param
  listAccounts(userId) {
    const data = this.getOrBuildUser(userId);
    const accounts = Array.from(data.accounts.values());
    this.log.debug(`UserAccountStore ← listAccounts user=${userId} → ${accounts.length} accounts`);
    return accounts;
  }

  // Compatible with AccountStore.getAccount(accountId) — userId is extra param
  getAccount(accountId, userId) {
    const data = this.getOrBuildUser(userId);
    const account = data.accounts.get(accountId);
    if (!account) {
      this.log.debug(`UserAccountStore ← getAccount ${accountId} not found for user=${userId}`);
      throw new FdxError(FDX_ERROR_CODES.ACCOUNT_NOT_FOUND, `Account not found: ${accountId}`);
    }
    return account;
  }

  // Compatible with AccountStore.getTransactions(accountId, { startTime, endTime })
  // userId comes AFTER the filters object
  getTransactions(accountId, filters = {}, userId) {
    this.getAccount(accountId, userId); // throws if not found
    const data = this.getOrBuildUser(userId);
    let txs = data.transactions.get(accountId) || [];

    const { startTime, endTime } = filters;
    if (startTime) {
      const start = new Date(startTime);
      txs = txs.filter(t => new Date(t.transactionTimestamp) >= start);
    }
    if (endTime) {
      const end = new Date(endTime);
      txs = txs.filter(t => new Date(t.transactionTimestamp) <= end);
    }

    this.log.debug(`UserAccountStore ← getTransactions user=${userId} account=${accountId} filtered=${txs.length}`);
    return txs;
  }

  // Compatible with AccountStore.getStatements(accountId)
  getStatements(accountId, userId) {
    this.getAccount(accountId, userId);
    const data = this.getOrBuildUser(userId);
    const stmts = data.statements.get(accountId) || [];
    this.log.debug(`UserAccountStore ← getStatements user=${userId} account=${accountId} → ${stmts.length}`);
    return stmts;
  }

  // Inject a transaction into a user's account (for admin demo)
  injectTransaction(accountId, transaction, userId) {
    const data = this.getOrBuildUser(userId);
    const account = data.accounts.get(accountId);
    if (!account) {
      throw new FdxError(FDX_ERROR_CODES.ACCOUNT_NOT_FOUND, `Account not found: ${accountId}`);
    }

    const txs = data.transactions.get(accountId) || [];
    txs.push(transaction);
    txs.sort((a, b) => new Date(b.transactionTimestamp) - new Date(a.transactionTimestamp));
    data.transactions.set(accountId, txs);

    this.log.info(`UserAccountStore → injected transaction into account=${accountId} user=${userId} desc="${transaction.description}"`);
    return transaction;
  }

  // Compatible with AccountStore.getPaymentNetworks(accountId)
  getPaymentNetworks(accountId, userId) {
    const account = this.getAccount(accountId, userId);
    const networks = [];
    if (account.accountCategory === 'DEPOSIT_ACCOUNT') {
      networks.push(
        { type: 'EFT', identifier: `***${account.accountId.slice(-4)}`, bankId: '001' },
        { type: 'INTERAC', identifier: `${userId || 'user'}@email.com` }
      );
    }
    this.log.debug(`UserAccountStore ← getPaymentNetworks user=${userId} account=${accountId} → ${networks.length} networks`);
    return networks;
  }
}

module.exports = UserAccountStore;
