const seedrandom = require('seedrandom');
const { v4: uuidv4 } = require('uuid');
const { MERCHANTS } = require('../merchants');
const { TRANSACTION_TYPES, TRANSACTION_STATUS, CURRENCY } = require('../constants');

class TransactionGenerator {
  constructor(seed = 'financial-os-default') {
    this.rng = seedrandom(seed);
    this.txCounter = 0;
  }

  // Generate a random float in [min, max) with 2 decimal places
  amount(min, max) {
    return Math.round((this.rng() * (max - min) + min) * 100) / 100;
  }

  // Pick a random element from an array
  pick(arr) {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  // Pick a random merchant from a category
  pickMerchant(category) {
    const merchants = MERCHANTS[category];
    if (!merchants || merchants.length === 0) return { name: 'Unknown Merchant', mcc: '0000' };
    return this.pick(merchants);
  }

  // Generate a date within a range
  randomDate(start, end) {
    const ts = start.getTime() + this.rng() * (end.getTime() - start.getTime());
    return new Date(ts);
  }

  // Build a single transaction object
  buildTransaction(accountId, { date, amount, type, merchant, category, description, status }) {
    this.txCounter++;
    return {
      transactionId: `${accountId}-tx-${String(this.txCounter).padStart(6, '0')}`,
      accountId,
      transactionTimestamp: date.toISOString(),
      description: description || merchant?.name || 'Transaction',
      amount: Math.abs(amount),
      currency: CURRENCY,
      transactionType: type,
      status: status || TRANSACTION_STATUS.POSTED,
      merchantName: merchant?.name,
      merchantCategoryCode: merchant?.mcc,
      category: category,
    };
  }

  /**
   * Generate 6 months of transactions for an account based on patterns.
   *
   * patterns = [
   *   { type: 'fixed_recurring', category, amount, dayOfMonth, description? }
   *   { type: 'variable_recurring', category, minAmount, maxAmount, dayOfMonth, variance? }
   *   { type: 'discretionary', category, minAmount, maxAmount, frequency, txType? }
   *   { type: 'income', description, amount, dayOfMonth, frequency? }
   *   { type: 'irregular_income', description, minAmount, maxAmount, minPerMonth, maxPerMonth }
   * ]
   */
  generateHistory(accountId, patterns, { months = 6, endDate } = {}) {
    const end = endDate || new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);

    const transactions = [];

    for (let m = 0; m < months; m++) {
      const monthStart = new Date(start);
      monthStart.setMonth(monthStart.getMonth() + m);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      for (const pattern of patterns) {
        const generated = this._generatePatternMonth(accountId, pattern, monthStart, monthEnd);
        transactions.push(...generated);
      }
    }

    // Sort by date descending (newest first)
    transactions.sort((a, b) => new Date(b.transactionTimestamp) - new Date(a.transactionTimestamp));
    return transactions;
  }

  _generatePatternMonth(accountId, pattern, monthStart, monthEnd) {
    switch (pattern.type) {
      case 'fixed_recurring':
        return this._fixedRecurring(accountId, pattern, monthStart);
      case 'variable_recurring':
        return this._variableRecurring(accountId, pattern, monthStart);
      case 'discretionary':
        return this._discretionary(accountId, pattern, monthStart, monthEnd);
      case 'income':
        return this._income(accountId, pattern, monthStart);
      case 'irregular_income':
        return this._irregularIncome(accountId, pattern, monthStart, monthEnd);
      default:
        return [];
    }
  }

  _fixedRecurring(accountId, pattern, monthStart) {
    const day = Math.min(pattern.dayOfMonth, 28);
    const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    const merchant = this.pickMerchant(pattern.category);
    return [this.buildTransaction(accountId, {
      date,
      amount: pattern.amount,
      type: TRANSACTION_TYPES.DEBIT,
      merchant,
      category: pattern.category,
      description: pattern.description,
    })];
  }

  _variableRecurring(accountId, pattern, monthStart) {
    const day = Math.min(pattern.dayOfMonth, 28);
    const variance = pattern.variance || 0.2;
    const baseAmount = (pattern.minAmount + pattern.maxAmount) / 2;
    const actualAmount = baseAmount + (this.rng() - 0.5) * 2 * baseAmount * variance;
    const clampedAmount = Math.max(pattern.minAmount, Math.min(pattern.maxAmount, actualAmount));

    const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    const merchant = this.pickMerchant(pattern.category);
    return [this.buildTransaction(accountId, {
      date,
      amount: Math.round(clampedAmount * 100) / 100,
      type: TRANSACTION_TYPES.DEBIT,
      merchant,
      category: pattern.category,
      description: pattern.description,
    })];
  }

  _discretionary(accountId, pattern, monthStart, monthEnd) {
    const count = Math.round(pattern.frequency + (this.rng() - 0.5) * pattern.frequency * 0.5);
    const txs = [];
    for (let i = 0; i < Math.max(1, count); i++) {
      const date = this.randomDate(monthStart, monthEnd);
      const merchant = this.pickMerchant(pattern.category);
      const amt = this.amount(pattern.minAmount, pattern.maxAmount);
      txs.push(this.buildTransaction(accountId, {
        date,
        amount: amt,
        type: pattern.txType || TRANSACTION_TYPES.DEBIT,
        merchant,
        category: pattern.category,
      }));
    }
    return txs;
  }

  _income(accountId, pattern, monthStart) {
    const days = pattern.frequency === 'biweekly' ? [1, 15] : [pattern.dayOfMonth || 1];
    return days.map(day => {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(day, 28));
      return this.buildTransaction(accountId, {
        date,
        amount: pattern.amount,
        type: TRANSACTION_TYPES.CREDIT,
        category: 'income',
        description: pattern.description,
      });
    });
  }

  _irregularIncome(accountId, pattern, monthStart, monthEnd) {
    const count = Math.floor(this.rng() * (pattern.maxPerMonth - pattern.minPerMonth + 1)) + pattern.minPerMonth;
    const txs = [];
    for (let i = 0; i < count; i++) {
      const date = this.randomDate(monthStart, monthEnd);
      const amt = this.amount(pattern.minAmount, pattern.maxAmount);
      txs.push(this.buildTransaction(accountId, {
        date,
        amount: amt,
        type: TRANSACTION_TYPES.CREDIT,
        category: 'income',
        description: pattern.description,
      }));
    }
    return txs;
  }
}

module.exports = TransactionGenerator;
