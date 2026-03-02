const { constants } = require('@financial-os/shared');
const { ACCOUNT_CATEGORIES, ACCOUNT_TYPES, ACCOUNT_STATUS } = constants;
const { businessChequingPatterns, businessVisaPatterns } = require('./patterns');

// Original alex-chen account data
const ALEX_CHEN_ACCOUNTS = require('./accounts');

// Seed user configs for Frontier Business
const SEED_USER_CONFIGS = {
  'priya-patel': {
    chequing: { balance: 18200, businessName: 'Patel Design Studio' },
    visa: { balance: 2400, businessName: 'Patel Design Studio' },
  },
  'david-kim': {
    chequing: { balance: 9800, businessName: 'Kim Analytics Corp' },
    visa: { balance: 1650, businessName: 'Kim Analytics Corp' },
  },
};

/**
 * Build per-user Frontier Business accounts.
 * - All users get business chequing ($5k-$25k)
 * - 70% get business Visa ($300-$3k)
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
    transactions.set('frt-biz-chq-001', transactionGen.generateHistory('frt-biz-chq-001', businessChequingPatterns));
    transactions.set('frt-biz-visa-001', transactionGen.generateHistory('frt-biz-visa-001', businessVisaPatterns));
    return { accounts, transactions, statements };
  }

  // Check for seed user config
  const seedCfg = SEED_USER_CONFIGS[userId];

  // Other users: generate from RNG (seed users override values)
  const prefix = `frt-${userId.slice(0, 6)}`;

  // Everyone gets business chequing
  const chqCfg = seedCfg?.chequing;
  const chqBalance = chqCfg ? chqCfg.balance : Math.round((5000 + rng() * 20000) * 100) / 100;
  const bizName = chqCfg ? chqCfg.businessName : `${userId} Consulting Inc.`;
  const chqId = `${prefix}-biz-chq-001`;
  accounts.set(chqId, {
    accountId: chqId,
    accountCategory: ACCOUNT_CATEGORIES.DEPOSIT,
    accountType: ACCOUNT_TYPES.CHECKING,
    status: ACCOUNT_STATUS.OPEN,
    displayName: 'Frontier Business Chequing',
    nickname: 'Business Operating',
    currency: 'CAD',
    institutionId: 'frontier-business',
    currentBalance: chqBalance,
    availableBalance: chqBalance,
    openDate: '2021-09-01',
    interestRate: 0,
    productName: 'Business Plus Chequing',
    businessName: bizName,
  });
  transactions.set(chqId, transactionGen.generateHistory(chqId, businessChequingPatterns));

  // Business Visa — seed users get it if configured, others 70%
  const hasVisa = seedCfg ? !!seedCfg.visa : rng() < 0.7;
  if (hasVisa) {
    const visaCfg = seedCfg?.visa;
    const visaBalance = visaCfg ? visaCfg.balance : Math.round((300 + rng() * 2700) * 100) / 100;
    const visaBizName = visaCfg ? visaCfg.businessName : bizName;
    const visaId = `${prefix}-biz-visa-001`;
    accounts.set(visaId, {
      accountId: visaId,
      accountCategory: ACCOUNT_CATEGORIES.LOC,
      accountType: ACCOUNT_TYPES.CREDIT_CARD,
      status: ACCOUNT_STATUS.OPEN,
      displayName: 'Frontier Business Visa',
      nickname: 'Business Expenses',
      currency: 'CAD',
      institutionId: 'frontier-business',
      currentBalance: visaBalance,
      creditLimit: 8000.00,
      availableCredit: Math.round((8000 - visaBalance) * 100) / 100,
      openDate: '2021-09-01',
      interestRate: 21.99,
      minimumPayment: Math.round(Math.max(33, visaBalance * 0.03) * 100) / 100,
      paymentDueDate: '2026-03-10',
      productName: 'Business Visa Gold',
      businessName: visaBizName,
    });
    transactions.set(visaId, transactionGen.generateHistory(visaId, businessVisaPatterns));
  }

  return { accounts, transactions, statements };
}

module.exports = { build };
