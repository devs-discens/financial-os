const { paginate, extractPaginationParams } = require('../pagination');
const { DATA_CLUSTERS, FDX_ERROR_CODES } = require('../constants');
const { requireScope } = require('../oauth/token-middleware');
const FdxError = require('../errors/fdx-error');

function createStatementsHandler(accountStore, log) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  function getStatements(req, res) {
    const { accountId } = req.params;
    const userId = req.tokenInfo ? req.tokenInfo.userId : null;
    const accountIds = req.tokenInfo ? req.tokenInfo.accountIds : null;
    log.debug(`FDX → /accounts/${accountId}/statements userId=${userId}`);

    // Check consent-level account filtering
    if (Array.isArray(accountIds) && !accountIds.includes(accountId)) {
      throw new FdxError(FDX_ERROR_CODES.FORBIDDEN, `Account ${accountId} not included in consent`);
    }
    const statements = accountStore.getStatements(accountId, userId);
    const paginationParams = extractPaginationParams(req.query);
    const result = paginate(statements, paginationParams);
    log.debug(`FDX ← /accounts/${accountId}/statements → ${result.data.length} statements (total=${result.page.totalElements})`);

    res.json({
      statements: result.data,
      page: result.page,
    });
  }

  return [requireScope(DATA_CLUSTERS.STATEMENTS), getStatements];
}

module.exports = createStatementsHandler;
