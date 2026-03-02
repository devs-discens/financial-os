const { FDX_ERROR_CODES } = require('../constants');
const FdxError = require('../errors/fdx-error');

class AccountStore {
  constructor(log) {
    this.log = log || { debug() {}, info() {}, warn() {}, error() {} };
    this.accounts = new Map();      // accountId -> account object
    this.transactions = new Map();  // accountId -> transaction[]
    this.statements = new Map();    // accountId -> statement[]
  }

  addAccount(account) {
    this.accounts.set(account.accountId, account);
    if (!this.transactions.has(account.accountId)) {
      this.transactions.set(account.accountId, []);
    }
    this.log.debug(`AccountStore → added account=${account.accountId} type=${account.accountType} category=${account.accountCategory}`);
  }

  addTransactions(accountId, txs) {
    const existing = this.transactions.get(accountId) || [];
    existing.push(...txs);
    // Keep sorted descending by date
    existing.sort((a, b) => new Date(b.transactionTimestamp) - new Date(a.transactionTimestamp));
    this.transactions.set(accountId, existing);
    this.log.debug(`AccountStore → added ${txs.length} transactions for account=${accountId} (total=${existing.length})`);
  }

  addStatements(accountId, stmts) {
    this.statements.set(accountId, stmts);
    this.log.debug(`AccountStore → added ${stmts.length} statements for account=${accountId}`);
  }

  listAccounts() {
    const accounts = Array.from(this.accounts.values());
    this.log.debug(`AccountStore ← listAccounts → ${accounts.length} accounts`);
    return accounts;
  }

  getAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) {
      this.log.debug(`AccountStore ← getAccount ${accountId} not found`);
      throw new FdxError(FDX_ERROR_CODES.ACCOUNT_NOT_FOUND, `Account not found: ${accountId}`);
    }
    return account;
  }

  getTransactions(accountId, { startTime, endTime } = {}) {
    this.getAccount(accountId); // throws if not found
    let txs = this.transactions.get(accountId) || [];

    if (startTime) {
      const start = new Date(startTime);
      txs = txs.filter(t => new Date(t.transactionTimestamp) >= start);
    }
    if (endTime) {
      const end = new Date(endTime);
      txs = txs.filter(t => new Date(t.transactionTimestamp) <= end);
    }

    this.log.debug(`AccountStore ← getTransactions account=${accountId} filtered=${txs.length}`);
    return txs;
  }

  getStatements(accountId) {
    this.getAccount(accountId);
    const stmts = this.statements.get(accountId) || [];
    this.log.debug(`AccountStore ← getStatements account=${accountId} → ${stmts.length}`);
    return stmts;
  }

  getPaymentNetworks(accountId) {
    const account = this.getAccount(accountId);
    const networks = [];
    if (account.accountCategory === 'DEPOSIT_ACCOUNT') {
      networks.push(
        { type: 'EFT', identifier: `***${account.accountId.slice(-4)}`, bankId: '001' },
        { type: 'INTERAC', identifier: 'alex.chen@email.com' }
      );
    }
    this.log.debug(`AccountStore ← getPaymentNetworks account=${accountId} → ${networks.length} networks`);
    return networks;
  }
}

module.exports = AccountStore;
