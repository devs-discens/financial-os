const { constants } = require('@financial-os/shared');
const { ACCOUNT_CATEGORIES, ACCOUNT_TYPES, ACCOUNT_STATUS } = constants;
const { chequingPatterns, visaPatterns, mastercardPatterns } = require('./patterns');

// Original alex-chen account data for backward compatibility
const ALEX_CHEN_ACCOUNTS = require('./accounts');

// Seed user configs — specific balances for demo users
const SEED_USER_CONFIGS = {
  'sarah-johnson': {
    chequing: { balance: 3100, nickname: 'Daily Banking' },
    visa: { balance: 1450, limit: 8000, nickname: 'Main Visa' },
    mastercard: { balance: 680, limit: 3000, nickname: 'Groceries Card' },
  },
  'marcus-williams': {
    chequing: { balance: 5800, nickname: 'Daily Banking' },
    visa: { balance: 3200, limit: 15000, nickname: 'Travel Visa' },
    mastercard: { balance: 780, limit: 5000, nickname: 'Groceries Card' },
  },
  'priya-patel': {
    chequing: { balance: 6500, nickname: 'Daily Banking' },
    visa: { balance: 2100, limit: 10000, nickname: 'Main Visa' },
    mastercard: { balance: 350, limit: 3000, nickname: 'Online Card' },
  },
  'david-kim': {
    chequing: { balance: 7200, nickname: 'Daily Banking' },
    visa: { balance: 4100, limit: 12000, nickname: 'Main Visa' },
    mastercard: { balance: 920, limit: 5000, nickname: 'Groceries Card' },
  },
  'emma-rodriguez': {
    chequing: { balance: 2400, nickname: 'Daily Banking' },
    visa: { balance: 1800, limit: 6000, nickname: 'Main Visa' },
    // No Mastercard
  },
};

/**
 * Build per-user Maple Direct accounts.
 * - All users get chequing (balance: $2k-$8k)
 * - 80% get Visa (balance: $500-$5k)
 * - 40% get Mastercard (balance: $100-$2k)
 * - alex-chen gets exact original values
 * - Seed users get specific balances from SEED_USER_CONFIGS
 */
function build(userId, rng, transactionGen) {
  const accounts = new Map();
  const transactions = new Map();
  const statements = new Map();

  // alex-chen: use exact original data
  if (userId === 'alex-chen') {
    for (const acct of ALEX_CHEN_ACCOUNTS) {
      accounts.set(acct.accountId, acct);
    }
    transactions.set('mpl-chq-001', transactionGen.generateHistory('mpl-chq-001', chequingPatterns));
    transactions.set('mpl-visa-001', transactionGen.generateHistory('mpl-visa-001', visaPatterns));
    transactions.set('mpl-mc-001', transactionGen.generateHistory('mpl-mc-001', mastercardPatterns));
    return { accounts, transactions, statements };
  }

  // Check for seed user config
  const seedCfg = SEED_USER_CONFIGS[userId];

  // Other users: generate from RNG (seed users override balances)
  const prefix = `mpl-${userId.slice(0, 6)}`;

  // Everyone gets chequing
  const chqBalance = seedCfg ? seedCfg.chequing.balance : Math.round((2000 + rng() * 6000) * 100) / 100;
  const chqId = `${prefix}-chq-001`;
  accounts.set(chqId, {
    accountId: chqId,
    accountCategory: ACCOUNT_CATEGORIES.DEPOSIT,
    accountType: ACCOUNT_TYPES.CHECKING,
    status: ACCOUNT_STATUS.OPEN,
    displayName: 'Maple Direct Chequing',
    nickname: seedCfg ? seedCfg.chequing.nickname : 'Daily Banking',
    currency: 'CAD',
    institutionId: 'maple-direct',
    currentBalance: chqBalance,
    availableBalance: chqBalance,
    openDate: '2020-01-15',
    interestRate: 0,
    productName: 'No-Fee Chequing',
  });
  transactions.set(chqId, transactionGen.generateHistory(chqId, chequingPatterns));

  // Visa — seed users always get it, others 80%
  const hasVisa = seedCfg ? !!seedCfg.visa : rng() < 0.8;
  if (hasVisa) {
    const visaCfg = seedCfg?.visa;
    const visaBalance = visaCfg ? visaCfg.balance : Math.round((500 + rng() * 4500) * 100) / 100;
    const visaLimit = visaCfg ? visaCfg.limit : 10000;
    const visaId = `${prefix}-visa-001`;
    accounts.set(visaId, {
      accountId: visaId,
      accountCategory: ACCOUNT_CATEGORIES.LOC,
      accountType: ACCOUNT_TYPES.CREDIT_CARD,
      status: ACCOUNT_STATUS.OPEN,
      displayName: 'Maple Visa Infinite',
      nickname: visaCfg ? visaCfg.nickname : 'Main Visa',
      currency: 'CAD',
      institutionId: 'maple-direct',
      currentBalance: visaBalance,
      creditLimit: visaLimit,
      availableCredit: Math.round((visaLimit - visaBalance) * 100) / 100,
      openDate: '2020-06-10',
      interestRate: 20.99,
      minimumPayment: Math.round(visaBalance * 0.03 * 100) / 100,
      paymentDueDate: '2026-03-15',
      productName: 'Visa Infinite Cashback',
    });
    transactions.set(visaId, transactionGen.generateHistory(visaId, visaPatterns));
  }

  // Mastercard — seed users get it if configured, others 40%
  const hasMc = seedCfg ? !!seedCfg.mastercard : rng() < 0.4;
  if (hasMc) {
    const mcCfg = seedCfg?.mastercard;
    const mcBalance = mcCfg ? mcCfg.balance : Math.round((100 + rng() * 1900) * 100) / 100;
    const mcLimit = mcCfg ? mcCfg.limit : 5000;
    const mcId = `${prefix}-mc-001`;
    accounts.set(mcId, {
      accountId: mcId,
      accountCategory: ACCOUNT_CATEGORIES.LOC,
      accountType: ACCOUNT_TYPES.CREDIT_CARD,
      status: ACCOUNT_STATUS.OPEN,
      displayName: 'Maple Mastercard',
      nickname: mcCfg ? mcCfg.nickname : 'Groceries Card',
      currency: 'CAD',
      institutionId: 'maple-direct',
      currentBalance: mcBalance,
      creditLimit: mcLimit,
      availableCredit: Math.round((mcLimit - mcBalance) * 100) / 100,
      openDate: '2021-09-20',
      interestRate: 19.99,
      minimumPayment: Math.round(Math.max(25, mcBalance * 0.03) * 100) / 100,
      paymentDueDate: '2026-03-20',
      productName: 'Mastercard Everyday',
    });
    transactions.set(mcId, transactionGen.generateHistory(mcId, mastercardPatterns));
  }

  return { accounts, transactions, statements };
}

module.exports = { build };
