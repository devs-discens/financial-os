const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const FdxError = require('./fdx-error');

describe('FdxError', () => {
  it('creates error with code and message', () => {
    const err = new FdxError(701, 'Account not found');
    assert.equal(err.code, 701);
    assert.equal(err.message, 'Account not found');
    assert.equal(err.debugMessage, null);
  });

  it('serializes to FDX JSON format', () => {
    const err = new FdxError(701, 'Account not found', 'No account with ID xyz');
    const json = err.toJSON();
    assert.deepEqual(json, {
      code: 701,
      message: 'Account not found',
      debugMessage: 'No account with ID xyz',
    });
  });

  it('omits debugMessage when null', () => {
    const err = new FdxError(500, 'Internal error');
    const json = err.toJSON();
    assert.equal(json.debugMessage, undefined);
  });

  it('maps 6xx codes to HTTP 404', () => {
    assert.equal(new FdxError(601, 'test').httpStatus, 404);
    assert.equal(new FdxError(602, 'test').httpStatus, 404);
  });

  it('maps 7xx codes to HTTP 404', () => {
    assert.equal(new FdxError(701, 'test').httpStatus, 404);
    assert.equal(new FdxError(704, 'test').httpStatus, 404);
  });

  it('maps 429 to HTTP 429', () => {
    assert.equal(new FdxError(429, 'test').httpStatus, 429);
  });

  it('maps 500 to HTTP 500', () => {
    assert.equal(new FdxError(500, 'test').httpStatus, 500);
  });
});
