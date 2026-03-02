// Transaction patterns for Alex Chen's Frontier Business accounts

const businessChequingPatterns = [
  // Irregular consulting income (2-4 clients/month, $1.5k-$6k each)
  { type: 'irregular_income', description: 'Client Payment - Consulting', minAmount: 1500, maxAmount: 6000, minPerMonth: 2, maxPerMonth: 4 },
  // Fixed business expenses
  { type: 'fixed_recurring', category: 'business', amount: 299, dayOfMonth: 1, description: 'WeWork - Coworking Membership' },
  { type: 'fixed_recurring', category: 'business', amount: 89.99, dayOfMonth: 5, description: 'Google Workspace Business' },
  { type: 'fixed_recurring', category: 'business', amount: 45, dayOfMonth: 10, description: 'GitHub Team' },
  // Variable business expenses
  { type: 'variable_recurring', category: 'business', minAmount: 150, maxAmount: 400, dayOfMonth: 15, description: 'Professional Insurance' },
  // Business tax installments (quarterly)
  { type: 'fixed_recurring', category: 'business', amount: 2500, dayOfMonth: 15, description: 'CRA HST Installment' },
];

const businessVisaPatterns = [
  // SaaS subscriptions
  { type: 'fixed_recurring', category: 'business', amount: 15, dayOfMonth: 3, description: 'Slack Pro' },
  { type: 'fixed_recurring', category: 'business', amount: 72, dayOfMonth: 7, description: 'Figma Business' },
  { type: 'fixed_recurring', category: 'business', amount: 79.99, dayOfMonth: 12, description: 'Adobe Creative Cloud' },
  // Client dinners/entertainment
  { type: 'discretionary', category: 'restaurants', minAmount: 60, maxAmount: 250, frequency: 3 },
  // Office supplies
  { type: 'discretionary', category: 'business', minAmount: 20, maxAmount: 150, frequency: 2 },
];

module.exports = { businessChequingPatterns, businessVisaPatterns };
