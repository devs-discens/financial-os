const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MERCHANTS, getMerchantsByCategory, getAllCategories } = require('./merchants');

describe('merchants', () => {
  it('has all expected categories', () => {
    const expected = ['groceries', 'restaurants', 'transit', 'utilities', 'subscriptions', 'shopping', 'healthcare', 'entertainment', 'business'];
    const actual = getAllCategories();
    for (const cat of expected) {
      assert.ok(actual.includes(cat), `Missing category: ${cat}`);
    }
  });

  it('each merchant has name and mcc', () => {
    for (const category of getAllCategories()) {
      for (const merchant of getMerchantsByCategory(category)) {
        assert.ok(merchant.name, `Merchant in ${category} missing name`);
        assert.ok(merchant.mcc, `${merchant.name} missing mcc`);
        assert.match(merchant.mcc, /^\d{4}$/, `${merchant.name} has invalid mcc: ${merchant.mcc}`);
      }
    }
  });

  it('returns empty array for unknown category', () => {
    assert.deepEqual(getMerchantsByCategory('nonexistent'), []);
  });

  it('has Canadian merchants', () => {
    const names = MERCHANTS.groceries.map(m => m.name);
    assert.ok(names.includes('Loblaws'));
    assert.ok(names.includes('Metro'));
  });
});
