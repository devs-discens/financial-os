const { DATA_CLUSTERS, FDX_ERROR_CODES } = require('../constants');
const { requireScope } = require('../oauth/token-middleware');
const FdxError = require('../errors/fdx-error');

function createPaymentNetworksHandler(accountStore, log) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  function getPaymentNetworks(req, res) {
    const { accountId } = req.params;
    const userId = req.tokenInfo ? req.tokenInfo.userId : null;
    const accountIds = req.tokenInfo ? req.tokenInfo.accountIds : null;
    log.debug(`FDX → /accounts/${accountId}/payment-networks userId=${userId}`);

    // Check consent-level account filtering
    if (Array.isArray(accountIds) && !accountIds.includes(accountId)) {
      throw new FdxError(FDX_ERROR_CODES.FORBIDDEN, `Account ${accountId} not included in consent`);
    }

    const networks = accountStore.getPaymentNetworks(accountId, userId);
    log.debug(`FDX ← /accounts/${accountId}/payment-networks → ${networks.length} networks`);
    res.json({ paymentNetworks: networks });
  }

  return [requireScope(DATA_CLUSTERS.PAYMENT_SUPPORT), getPaymentNetworks];
}

module.exports = createPaymentNetworksHandler;
