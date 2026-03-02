const { DATA_CLUSTERS, FDX_ERROR_CODES } = require('../constants');
const { requireScope } = require('../oauth/token-middleware');
const FdxError = require('../errors/fdx-error');

function createAccountDetailHandler(accountStore, log) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  function getAccountDetail(req, res) {
    const { accountId } = req.params;
    const userId = req.tokenInfo ? req.tokenInfo.userId : null;
    const accountIds = req.tokenInfo ? req.tokenInfo.accountIds : null;
    log.debug(`FDX → /accounts/${accountId} detail userId=${userId}`);

    // Check consent-level account filtering
    if (Array.isArray(accountIds) && !accountIds.includes(accountId)) {
      throw new FdxError(FDX_ERROR_CODES.FORBIDDEN, `Account ${accountId} not included in consent`);
    }

    const account = accountStore.getAccount(accountId, userId);
    log.debug(`FDX ← /accounts/${accountId} type=${account.accountType} category=${account.accountCategory}`);
    res.json(account);
  }

  return [requireScope(DATA_CLUSTERS.ACCOUNT_DETAILED), getAccountDetail];
}

module.exports = createAccountDetailHandler;
