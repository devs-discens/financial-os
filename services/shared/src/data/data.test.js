const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const TransactionGenerator = require('./transaction-generator');
const AccountStore = require('./account-store');

describe('TransactionGenerator', () => {
  it('produces deterministic output with same seed', () => {
    const gen1 = new TransactionGenerator('test-seed');
    const gen2 = new TransactionGenerator('test-seed');

    const tx1 = gen1.generateHistory('acct-001', [
      { type: 'fixed_recurring', category: 'utilities', amount: 120, dayOfMonth: 15 },
    ], { months: 3 });

    const tx2 = gen2.generateHistory('acct-001', [
      { type: 'fixed_recurring', category: 'utilities', amount: 120, dayOfMonth: 15 },
    ], { months: 3 });

    assert.equal(tx1.length, tx2.length);
    for (let i = 0; i < tx1.length; i++) {
      assert.equal(tx1[i].amount, tx2[i].amount);
      assert.equal(tx1[i].transactionTimestamp, tx2[i].transactionTimestamp);
      assert.equal(tx1[i].merchantName, tx2[i].merchantName);
    }
  });

  it('produces different output with different seeds', () => {
    const gen1 = new TransactionGenerator('seed-a');
    const gen2 = new TransactionGenerator('seed-b');

    const tx1 = gen1.generateHistory('acct-001', [
      { type: 'discretionary', category: 'restaurants', minAmount: 10, maxAmount: 80, frequency: 5 },
    ], { months: 2 });

    const tx2 = gen2.generateHistory('acct-001', [
      { type: 'discretionary', category: 'restaurants', minAmount: 10, maxAmount: 80, frequency: 5 },
    ], { months: 2 });

    // Very unlikely to match
    const amounts1 = tx1.map(t => t.amount);
    const amounts2 = tx2.map(t => t.amount);
    assert.notDeepEqual(amounts1, amounts2);
  });

  it('generates fixed recurring transactions', () => {
    const gen = new TransactionGenerator('fixed-test');
    const txs = gen.generateHistory('acct-001', [
      { type: 'fixed_recurring', category: 'utilities', amount: 150, dayOfMonth: 1 },
    ], { months: 6 });

    assert.equal(txs.length, 6);
    for (const tx of txs) {
      assert.equal(tx.amount, 150);
      assert.equal(tx.transactionType, 'DEBIT');
      assert.equal(tx.category, 'utilities');
      assert.equal(tx.currency, 'CAD');
    }
  });

  it('generates income transactions as CREDIT', () => {
    const gen = new TransactionGenerator('income-test');
    const txs = gen.generateHistory('acct-001', [
      { type: 'income', description: 'Salary', amount: 4038, dayOfMonth: 1 },
    ], { months: 3 });

    assert.equal(txs.length, 3);
    for (const tx of txs) {
      assert.equal(tx.transactionType, 'CREDIT');
      assert.equal(tx.amount, 4038);
      assert.equal(tx.description, 'Salary');
    }
  });

  it('generates biweekly income (2 per month)', () => {
    const gen = new TransactionGenerator('biweekly-test');
    const txs = gen.generateHistory('acct-001', [
      { type: 'income', description: 'Paycheque', amount: 2019, frequency: 'biweekly' },
    ], { months: 3 });

    assert.equal(txs.length, 6);
  });

  it('generates variable recurring within range', () => {
    const gen = new TransactionGenerator('variable-test');
    const txs = gen.generateHistory('acct-001', [
      { type: 'variable_recurring', category: 'utilities', minAmount: 80, maxAmount: 200, dayOfMonth: 15 },
    ], { months: 6 });

    assert.equal(txs.length, 6);
    for (const tx of txs) {
      assert.ok(tx.amount >= 80, `Amount ${tx.amount} below min`);
      assert.ok(tx.amount <= 200, `Amount ${tx.amount} above max`);
    }
  });

  it('generates irregular income within count range', () => {
    const gen = new TransactionGenerator('irregular-test');
    const txs = gen.generateHistory('acct-001', [
      { type: 'irregular_income', description: 'Client Payment', minAmount: 1500, maxAmount: 6000, minPerMonth: 2, maxPerMonth: 4 },
    ], { months: 6 });

    // 2-4 per month x 6 months = 12-24 total
    assert.ok(txs.length >= 12, `Too few: ${txs.length}`);
    assert.ok(txs.length <= 24, `Too many: ${txs.length}`);
    for (const tx of txs) {
      assert.equal(tx.transactionType, 'CREDIT');
      assert.ok(tx.amount >= 1500);
      assert.ok(tx.amount <= 6000);
    }
  });

  it('transactions are sorted newest first', () => {
    const gen = new TransactionGenerator('sort-test');
    const txs = gen.generateHistory('acct-001', [
      { type: 'discretionary', category: 'groceries', minAmount: 30, maxAmount: 200, frequency: 4 },
    ], { months: 3 });

    for (let i = 1; i < txs.length; i++) {
      assert.ok(
        new Date(txs[i - 1].transactionTimestamp) >= new Date(txs[i].transactionTimestamp),
        'Transactions not sorted descending'
      );
    }
  });

  it('each transaction has unique ID', () => {
    const gen = new TransactionGenerator('id-test');
    const txs = gen.generateHistory('acct-001', [
      { type: 'discretionary', category: 'restaurants', minAmount: 10, maxAmount: 80, frequency: 8 },
    ], { months: 3 });

    const ids = new Set(txs.map(t => t.transactionId));
    assert.equal(ids.size, txs.length);
  });
});

describe('AccountStore', () => {
  let store;

  beforeEach(() => {
    store = new AccountStore();
    store.addAccount({
      accountId: 'acct-001',
      accountCategory: 'DEPOSIT_ACCOUNT',
      accountType: 'CHECKING',
      displayName: 'Chequing',
    });
  });

  it('lists accounts', () => {
    const accounts = store.listAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].accountId, 'acct-001');
  });

  it('gets account by id', () => {
    const account = store.getAccount('acct-001');
    assert.equal(account.displayName, 'Chequing');
  });

  it('throws FdxError for unknown account', () => {
    assert.throws(() => store.getAccount('nonexistent'), { name: 'FdxError', code: 701 });
  });

  it('stores and retrieves transactions', () => {
    store.addTransactions('acct-001', [
      { transactionId: 'tx-1', accountId: 'acct-001', transactionTimestamp: '2025-06-15T12:00:00Z', amount: 50 },
      { transactionId: 'tx-2', accountId: 'acct-001', transactionTimestamp: '2025-06-10T12:00:00Z', amount: 30 },
    ]);

    const txs = store.getTransactions('acct-001');
    assert.equal(txs.length, 2);
    // Should be sorted descending
    assert.equal(txs[0].transactionId, 'tx-1');
  });

  it('filters transactions by date range', () => {
    store.addTransactions('acct-001', [
      { transactionId: 'tx-1', accountId: 'acct-001', transactionTimestamp: '2025-06-15T12:00:00Z', amount: 50 },
      { transactionId: 'tx-2', accountId: 'acct-001', transactionTimestamp: '2025-05-10T12:00:00Z', amount: 30 },
      { transactionId: 'tx-3', accountId: 'acct-001', transactionTimestamp: '2025-04-01T12:00:00Z', amount: 20 },
    ]);

    const filtered = store.getTransactions('acct-001', { startTime: '2025-05-01', endTime: '2025-06-01' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].transactionId, 'tx-2');
  });

  it('returns payment networks for deposit accounts', () => {
    const networks = store.getPaymentNetworks('acct-001');
    assert.equal(networks.length, 2);
    assert.equal(networks[0].type, 'EFT');
    assert.equal(networks[1].type, 'INTERAC');
  });

  it('throws for transactions on unknown account', () => {
    assert.throws(() => store.getTransactions('nonexistent'), { name: 'FdxError', code: 701 });
  });
});
