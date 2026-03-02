// Canadian merchant database by category
const MERCHANTS = {
  groceries: [
    { name: 'Loblaws', mcc: '5411' },
    { name: 'Metro', mcc: '5411' },
    { name: 'Sobeys', mcc: '5411' },
    { name: 'No Frills', mcc: '5411' },
    { name: 'Farm Boy', mcc: '5411' },
    { name: 'Costco Wholesale', mcc: '5411' },
    { name: 'T&T Supermarket', mcc: '5411' },
    { name: 'FreshCo', mcc: '5411' },
  ],
  restaurants: [
    { name: 'Tim Hortons', mcc: '5812' },
    { name: 'A&W', mcc: '5812' },
    { name: 'Swiss Chalet', mcc: '5812' },
    { name: 'Boston Pizza', mcc: '5812' },
    { name: 'The Keg', mcc: '5812' },
    { name: 'Uber Eats', mcc: '5812' },
    { name: 'DoorDash', mcc: '5812' },
    { name: 'Starbucks', mcc: '5814' },
  ],
  transit: [
    { name: 'TTC', mcc: '4111' },
    { name: 'Presto', mcc: '4111' },
    { name: 'Petro-Canada', mcc: '5541' },
    { name: 'Canadian Tire Gas', mcc: '5541' },
    { name: 'Shell', mcc: '5541' },
    { name: 'Esso', mcc: '5541' },
  ],
  utilities: [
    { name: 'Toronto Hydro', mcc: '4900' },
    { name: 'Enbridge Gas', mcc: '4900' },
    { name: 'Bell Canada', mcc: '4814' },
    { name: 'Rogers', mcc: '4814' },
    { name: 'Telus', mcc: '4814' },
    { name: 'Fido', mcc: '4814' },
  ],
  subscriptions: [
    { name: 'Netflix', mcc: '4899' },
    { name: 'Spotify', mcc: '4899' },
    { name: 'Amazon Prime', mcc: '5942' },
    { name: 'Apple iCloud', mcc: '4899' },
    { name: 'Disney+', mcc: '4899' },
    { name: 'YouTube Premium', mcc: '4899' },
    { name: 'Crave', mcc: '4899' },
  ],
  shopping: [
    { name: 'Amazon.ca', mcc: '5999' },
    { name: 'Canadian Tire', mcc: '5251' },
    { name: 'Walmart Canada', mcc: '5311' },
    { name: 'Winners', mcc: '5651' },
    { name: 'IKEA', mcc: '5712' },
    { name: 'Best Buy', mcc: '5732' },
    { name: 'Home Depot', mcc: '5200' },
    { name: 'Indigo', mcc: '5942' },
  ],
  healthcare: [
    { name: 'Shoppers Drug Mart', mcc: '5912' },
    { name: 'Rexall', mcc: '5912' },
    { name: 'LifeLabs', mcc: '8099' },
  ],
  entertainment: [
    { name: 'Cineplex', mcc: '7832' },
    { name: 'Ticketmaster', mcc: '7922' },
    { name: 'GoodLife Fitness', mcc: '7941' },
    { name: 'LCBO', mcc: '5921' },
    { name: 'The Beer Store', mcc: '5921' },
  ],
  business: [
    { name: 'Slack Technologies', mcc: '7372' },
    { name: 'GitHub', mcc: '7372' },
    { name: 'Google Workspace', mcc: '7372' },
    { name: 'Figma', mcc: '7372' },
    { name: 'Adobe Creative Cloud', mcc: '7372' },
    { name: 'WeWork', mcc: '6513' },
    { name: 'Regus', mcc: '6513' },
    { name: 'Staples Business', mcc: '5943' },
    { name: 'Vistaprint', mcc: '2741' },
  ],
};

function getMerchantsByCategory(category) {
  return MERCHANTS[category] || [];
}

function getAllCategories() {
  return Object.keys(MERCHANTS);
}

module.exports = { MERCHANTS, getMerchantsByCategory, getAllCategories };
