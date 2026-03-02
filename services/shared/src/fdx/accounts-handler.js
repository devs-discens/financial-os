const { paginate, extractPaginationParams } = require('../pagination');
const { DATA_CLUSTERS } = require('../constants');
const { requireScope } = require('../oauth/token-middleware');

function createAccountsHandler(accountStore, log) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  function listAccounts(req, res) {
    const userId = req.tokenInfo ? req.tokenInfo.userId : null;
    const accountIds = req.tokenInfo ? req.tokenInfo.accountIds : null;
    let accounts = accountStore.listAccounts(userId);

    // Filter by consented account IDs if set
    if (Array.isArray(accountIds)) {
      accounts = accounts.filter(a => accountIds.includes(a.accountId));
    }

    const paginationParams = extractPaginationParams(req.query);
    const result = paginate(accounts, paginationParams);
    log.debug(`FDX ← /accounts → ${result.data.length} accounts (total=${result.page.totalElements}) userId=${userId} consentFilter=${accountIds ? accountIds.length : 'all'}`);
    res.json({
      accounts: result.data,
      page: result.page,
    });
  }

  return [requireScope(DATA_CLUSTERS.ACCOUNT_BASIC), listAccounts];
}

module.exports = createAccountsHandler;
