function createRevokeHandler(tokenStore, log) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  return function revokeHandler(req, res) {
    const { token } = req.body;
    log.debug(`OAuth → revoke token=${token?.slice(0, 8)}...`);

    if (!token) {
      log.debug(`OAuth ← revoke rejected: no token provided`);
      return res.status(400).json({ error: 'invalid_request', error_description: 'token required' });
    }

    const revoked = tokenStore.revokeToken(token);
    log.info(`OAuth ← revoke ${revoked ? 'success' : 'token not found (ok per RFC 7009)'}`);
    // RFC 7009: always return 200, even if token was invalid
    res.status(200).json({ status: 'revoked' });
  };
}

module.exports = createRevokeHandler;
