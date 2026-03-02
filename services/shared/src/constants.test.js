const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const constants = require('./constants');

describe('constants', () => {
  it('exports all required account categories', () => {
    assert.equal(constants.ACCOUNT_CATEGORIES.DEPOSIT, 'DEPOSIT_ACCOUNT');
    assert.equal(constants.ACCOUNT_CATEGORIES.LOAN, 'LOAN_ACCOUNT');
    assert.equal(constants.ACCOUNT_CATEGORIES.LOC, 'LOC_ACCOUNT');
  });

  it('exports FDX error codes', () => {
    assert.equal(constants.FDX_ERROR_CODES.ACCOUNT_NOT_FOUND, 701);
    assert.equal(constants.FDX_ERROR_CODES.CUSTOMER_NOT_FOUND, 601);
    assert.equal(constants.FDX_ERROR_CODES.TOO_MANY_REQUESTS, 429);
  });

  it('exports token TTLs', () => {
    assert.equal(constants.TOKEN_TTL.ACCESS_TOKEN_MS, 30 * 60 * 1000);
    assert.equal(constants.TOKEN_TTL.REFRESH_TOKEN_MS, 90 * 24 * 60 * 60 * 1000);
  });

  it('exports CAD currency', () => {
    assert.equal(constants.CURRENCY, 'CAD');
  });

  it('OAUTH_SCOPES matches DATA_CLUSTERS values', () => {
    const clusterValues = Object.values(constants.DATA_CLUSTERS);
    assert.deepEqual(constants.OAUTH_SCOPES, clusterValues);
  });
});
