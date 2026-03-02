const { constants } = require('@financial-os/shared');
const { ACCOUNT_CATEGORIES, ACCOUNT_TYPES, ACCOUNT_STATUS } = constants;
const { generateAmortizationSchedule } = require('./statements');

// Original alex-chen account data
const ALEX_CHEN_ACCOUNTS = require('./accounts');

// Seed user configs for Heritage Financial
const SEED_USER_CONFIGS = {
  'marcus-williams': {
    mortgage: { principal: 310000, rate: 5.29, propertyValue: 520000 },
    heloc: { limit: 25000, balance: 4200 },
  },
  'david-kim': {
    mortgage: { principal: 425000, rate: 4.49, propertyValue: 710000 },
    heloc: { limit: 40000, balance: 8500 },
  },
  'emma-rodriguez': {
    mortgage: { principal: 265000, rate: 5.75, propertyValue: 445000 },
    heloc: { limit: 15000, balance: 2100 },
  },
};

/**
 * Build per-user Heritage Financial accounts.
 * - All users get mortgage (principal: $200k-$600k)
 * - 60% get HELOC
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
    const mortgage = ALEX_CHEN_ACCOUNTS.find(a => a.accountId === 'htg-mtg-001');
    statements.set('htg-mtg-001', generateAmortizationSchedule(mortgage));
    return { accounts, transactions, statements };
  }

  // Check for seed user config
  const seedCfg = SEED_USER_CONFIGS[userId];

  // Other users: generate from RNG (seed users override values)
  const prefix = `htg-${userId.slice(0, 6)}`;

  // Everyone gets a mortgage
  const principal = seedCfg ? seedCfg.mortgage.principal : Math.round((200000 + rng() * 400000) * 100) / 100;
  const originalPrincipal = Math.round(principal * (1.1 + rng() * 0.3) * 100) / 100;
  const rate = seedCfg ? seedCfg.mortgage.rate : Math.round((3.5 + rng() * 3.0) * 100) / 100;
  const monthlyPayment = Math.round((principal * (rate / 100 / 12)) / (1 - Math.pow(1 + rate / 100 / 12, -300)) * 100) / 100;
  const mtgId = `${prefix}-mtg-001`;

  // Property value: seed users have explicit values, others estimate from original principal + appreciation
  const propertyValue = seedCfg
    ? seedCfg.mortgage.propertyValue
    : Math.round(originalPrincipal * (1.2 + rng() * 0.4) * 100) / 100;

  const mortgage = {
    accountId: mtgId,
    accountCategory: ACCOUNT_CATEGORIES.LOAN,
    accountType: ACCOUNT_TYPES.MORTGAGE,
    status: ACCOUNT_STATUS.OPEN,
    displayName: 'Heritage Fixed Rate Mortgage',
    nickname: 'Home Mortgage',
    currency: 'CAD',
    institutionId: 'heritage-financial',
    principalBalance: principal,
    originalPrincipal,
    propertyValue,
    interestRate: rate,
    interestRateType: 'FIXED',
    compounding: 'SEMI_ANNUAL',
    paymentFrequency: 'MONTHLY',
    monthlyPayment,
    maturityDate: '2049-10-15',
    termEndDate: '2027-04-15',
    termLength: '5 years',
    amortizationPeriod: '25 years',
    originalStartDate: '2022-04-15',
    openDate: '2022-04-15',
  };
  accounts.set(mtgId, mortgage);
  statements.set(mtgId, generateAmortizationSchedule(mortgage));

  // HELOC — seed users get it if configured, others 60%
  const hasHeloc = seedCfg ? !!seedCfg.heloc : rng() < 0.6;
  if (hasHeloc) {
    const helocCfg = seedCfg?.heloc;
    const helocLimit = helocCfg ? helocCfg.limit : Math.round((10000 + rng() * 40000) * 100) / 100;
    const helocBalance = helocCfg ? helocCfg.balance : Math.round(rng() * helocLimit * 0.3 * 100) / 100;
    const helocId = `${prefix}-heloc-001`;
    accounts.set(helocId, {
      accountId: helocId,
      accountCategory: ACCOUNT_CATEGORIES.LOC,
      accountType: ACCOUNT_TYPES.LINE_OF_CREDIT,
      status: ACCOUNT_STATUS.OPEN,
      displayName: 'Heritage HELOC',
      nickname: 'Home Equity Line',
      currency: 'CAD',
      institutionId: 'heritage-financial',
      currentBalance: helocBalance,
      creditLimit: helocLimit,
      availableCredit: Math.round((helocLimit - helocBalance) * 100) / 100,
      interestRate: 6.95,
      interestRateType: 'VARIABLE',
      primeRate: 5.45,
      rateAbovePrime: 1.50,
      openDate: '2022-04-15',
    });
  }

  return { accounts, transactions, statements };
}

module.exports = { build };
