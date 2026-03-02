const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { paginate, extractPaginationParams } = require('./pagination');

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));

  it('returns first page with default limit', () => {
    const result = paginate(items);
    assert.equal(result.data.length, 25);
    assert.equal(result.page.totalElements, 25);
    assert.equal(result.page.nextOffset, null);
  });

  it('paginates with custom limit', () => {
    const result = paginate(items, { limit: 10 });
    assert.equal(result.data.length, 10);
    assert.equal(result.page.totalElements, 25);
    assert.equal(result.page.nextOffset, '10');
  });

  it('paginates with offset', () => {
    const result = paginate(items, { offset: '10', limit: 10 });
    assert.equal(result.data.length, 10);
    assert.equal(result.data[0].id, 11);
    assert.equal(result.page.nextOffset, '20');
  });

  it('returns null nextOffset on last page', () => {
    const result = paginate(items, { offset: '20', limit: 10 });
    assert.equal(result.data.length, 5);
    assert.equal(result.page.nextOffset, null);
  });

  it('clamps limit to MAX_LIMIT', () => {
    const bigItems = Array.from({ length: 600 }, (_, i) => i);
    const result = paginate(bigItems, { limit: 1000 });
    assert.equal(result.data.length, 500);
  });
});

describe('extractPaginationParams', () => {
  it('extracts offset and limit from query', () => {
    const params = extractPaginationParams({ offset: '10', limit: '20' });
    assert.equal(params.offset, '10');
    assert.equal(params.limit, '20');
  });

  it('defaults offset to 0', () => {
    const params = extractPaginationParams({});
    assert.equal(params.offset, '0');
  });
});
