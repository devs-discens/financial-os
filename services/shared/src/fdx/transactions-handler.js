const { paginate, extractPaginationParams } = require('../pagination');
const { DATA_CLUSTERS, FDX_ERROR_CODES } = require('../constants');
const { requireScope } = require('../oauth/token-middleware');
const FdxError = require('../errors/fdx-error');

function createTransactionsHandler(accountStore, log) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  function getTransactions(req, res) {
    const { accountId } = req.params;
    const { startTime, endTime } = req.query;
    const userId = req.tokenInfo ? req.tokenInfo.userId : null;
    const accountIds = req.tokenInfo ? req.tokenInfo.accountIds : null;
    log.debug(`FDX → /accounts/${accountId}/transactions startTime=${startTime || 'none'} endTime=${endTime || 'none'} userId=${userId}`);

    // Check consent-level account filtering
    if (Array.isArray(accountIds) && !accountIds.includes(accountId)) {
      throw new FdxError(FDX_ERROR_CODES.FORBIDDEN, `Account ${accountId} not included in consent`);
    }

    if (startTime && isNaN(Date.parse(startTime))) {
      throw new FdxError(FDX_ERROR_CODES.INVALID_START_DATE, `Invalid startTime: ${startTime}`);
    }
    if (endTime && isNaN(Date.parse(endTime))) {
      throw new FdxError(FDX_ERROR_CODES.INVALID_END_DATE, `Invalid endTime: ${endTime}`);
    }

    const transactions = accountStore.getTransactions(accountId, { startTime, endTime }, userId);
    const paginationParams = extractPaginationParams(req.query);
    const result = paginate(transactions, paginationParams);

    log.debug(`FDX ← /accounts/${accountId}/transactions → ${result.data.length} txns (total=${result.page.totalElements})`);
    res.json({
      transactions: result.data,
      page: result.page,
    });
  }

  return [requireScope(DATA_CLUSTERS.TRANSACTIONS), getTransactions];
}

module.exports = createTransactionsHandler;
