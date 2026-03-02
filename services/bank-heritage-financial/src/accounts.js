const { constants } = require('@financial-os/shared');
const { ACCOUNT_CATEGORIES, ACCOUNT_TYPES, ACCOUNT_STATUS } = constants;

const accounts = [
  {
    accountId: 'htg-mtg-001',
    accountCategory: ACCOUNT_CATEGORIES.LOAN,
    accountType: ACCOUNT_TYPES.MORTGAGE,
    status: ACCOUNT_STATUS.OPEN,
    displayName: 'Heritage Fixed Rate Mortgage',
    nickname: 'Home Mortgage',
    currency: 'CAD',
    institutionId: 'heritage-financial',
    // Mortgage-specific fields
    principalBalance: 385000.00,
    originalPrincipal: 450000.00,
    interestRate: 4.89,
    interestRateType: 'FIXED',
    compounding: 'SEMI_ANNUAL', // Canadian mortgage standard
    paymentFrequency: 'MONTHLY',
    monthlyPayment: 2547.32,
    maturityDate: '2029-10-15',
    termEndDate: '2027-04-15', // 14 months from now
    termLength: '5 years',
    amortizationPeriod: '25 years',
    originalStartDate: '2022-04-15',
    propertyAddress: '45 King Street West, Toronto, ON M5H 1J8',
    propertyValue: 685000.00,
    openDate: '2022-04-15',
  },
  {
    accountId: 'htg-heloc-001',
    accountCategory: ACCOUNT_CATEGORIES.LOC,
    accountType: ACCOUNT_TYPES.LINE_OF_CREDIT,
    status: ACCOUNT_STATUS.OPEN,
    displayName: 'Heritage HELOC',
    nickname: 'Home Equity Line',
    currency: 'CAD',
    institutionId: 'heritage-financial',
    currentBalance: 0.00,
    creditLimit: 15000.00,
    availableCredit: 15000.00,
    interestRate: 6.95,
    interestRateType: 'VARIABLE',
    primeRate: 5.45,
    rateAbovePrime: 1.50,
    openDate: '2022-04-15',
  },
];

module.exports = accounts;
