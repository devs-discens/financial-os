// Transaction patterns for Alex Chen's Maple Direct accounts

const chequingPatterns = [
  // Income
  { type: 'income', description: 'ACME Corp Payroll Direct Deposit', amount: 4038.46, frequency: 'biweekly' },
  // Fixed recurring
  { type: 'fixed_recurring', category: 'utilities', amount: 2200, dayOfMonth: 1, description: 'Rent - 45 King St W' },
  { type: 'fixed_recurring', category: 'utilities', amount: 65, dayOfMonth: 5, description: 'Bell Canada - Internet' },
  { type: 'fixed_recurring', category: 'utilities', amount: 85, dayOfMonth: 8, description: 'Fido Wireless' },
  // Variable recurring
  { type: 'variable_recurring', category: 'utilities', minAmount: 45, maxAmount: 120, dayOfMonth: 12, description: 'Toronto Hydro' },
  { type: 'variable_recurring', category: 'utilities', minAmount: 30, maxAmount: 90, dayOfMonth: 18, description: 'Enbridge Gas' },
  // Discretionary
  { type: 'discretionary', category: 'groceries', minAmount: 35, maxAmount: 180, frequency: 4 },
  { type: 'discretionary', category: 'restaurants', minAmount: 12, maxAmount: 75, frequency: 6 },
  { type: 'discretionary', category: 'transit', minAmount: 20, maxAmount: 85, frequency: 3 },
  { type: 'discretionary', category: 'entertainment', minAmount: 15, maxAmount: 60, frequency: 2 },
];

const visaPatterns = [
  // Subscriptions
  { type: 'fixed_recurring', category: 'subscriptions', amount: 22.99, dayOfMonth: 3, description: 'Netflix' },
  { type: 'fixed_recurring', category: 'subscriptions', amount: 11.99, dayOfMonth: 7, description: 'Spotify Premium' },
  { type: 'fixed_recurring', category: 'subscriptions', amount: 9.99, dayOfMonth: 12, description: 'Disney+' },
  { type: 'fixed_recurring', category: 'subscriptions', amount: 13.99, dayOfMonth: 20, description: 'Amazon Prime' },
  // Shopping
  { type: 'discretionary', category: 'shopping', minAmount: 25, maxAmount: 250, frequency: 3 },
  // Restaurants
  { type: 'discretionary', category: 'restaurants', minAmount: 30, maxAmount: 120, frequency: 4 },
  // Entertainment
  { type: 'discretionary', category: 'entertainment', minAmount: 20, maxAmount: 100, frequency: 2 },
];

const mastercardPatterns = [
  // Primarily groceries
  { type: 'discretionary', category: 'groceries', minAmount: 30, maxAmount: 160, frequency: 5 },
  // Healthcare
  { type: 'discretionary', category: 'healthcare', minAmount: 15, maxAmount: 80, frequency: 1 },
];

module.exports = { chequingPatterns, visaPatterns, mastercardPatterns };
