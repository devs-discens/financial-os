const { PAGINATION_DEFAULTS } = require('./constants');

function paginate(items, { offset, limit } = {}) {
  const parsedOffset = offset ? parseInt(offset, 10) : 0;
  const parsedLimit = Math.min(
    Math.max(parseInt(limit, 10) || PAGINATION_DEFAULTS.LIMIT, 1),
    PAGINATION_DEFAULTS.MAX_LIMIT
  );

  const page = items.slice(parsedOffset, parsedOffset + parsedLimit);
  const nextOffset = parsedOffset + parsedLimit;
  const hasMore = nextOffset < items.length;

  return {
    data: page,
    page: {
      totalElements: items.length,
      nextOffset: hasMore ? String(nextOffset) : null,
    },
  };
}

function extractPaginationParams(query) {
  return {
    offset: query.offset || '0',
    limit: query.limit,
  };
}

module.exports = { paginate, extractPaginationParams };
