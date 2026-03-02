const { constants } = require('@financial-os/shared');
const { ACCOUNT_CATEGORIES, ACCOUNT_TYPES, ACCOUNT_STATUS } = constants;

const accounts = [
  {
    accountId: 'frt-biz-chq-001',
    accountCategory: ACCOUNT_CATEGORIES.DEPOSIT,
    accountType: ACCOUNT_TYPES.CHECKING,
    status: ACCOUNT_STATUS.OPEN,
    displayName: 'Frontier Business Chequing',
    nickname: 'Business Operating',
    currency: 'CAD',
    institutionId: 'frontier-business',
    currentBalance: 12400.00,
    availableBalance: 12400.00,
    openDate: '2021-09-01',
    interestRate: 0,
    productName: 'Business Plus Chequing',
    businessName: 'Chen Consulting Inc.',
    businessNumber: 'BN123456789',
  },
  {
    accountId: 'frt-biz-visa-001',
    accountCategory: ACCOUNT_CATEGORIES.LOC,
    accountType: ACCOUNT_TYPES.CREDIT_CARD,
    status: ACCOUNT_STATUS.OPEN,
    displayName: 'Frontier Business Visa',
    nickname: 'Business Expenses',
    currency: 'CAD',
    institutionId: 'frontier-business',
    currentBalance: 1100.00,
    creditLimit: 8000.00,
    availableCredit: 6900.00,
    openDate: '2021-09-01',
    interestRate: 21.99,
    minimumPayment: 33.00,
    paymentDueDate: '2026-03-10',
    productName: 'Business Visa Gold',
    businessName: 'Chen Consulting Inc.',
  },
];

module.exports = accounts;
