function createTokenHandler(tokenStore, log) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  return function tokenHandler(req, res) {
    const { grant_type, code, redirect_uri, client_id, refresh_token } = req.body;
    log.debug(`OAuth → token grant_type=${grant_type} client=${client_id}`);

    if (grant_type === 'authorization_code') {
      if (!code || !redirect_uri || !client_id) {
        log.debug(`OAuth ← token rejected: missing params for authorization_code`);
        return res.status(400).json({ error: 'invalid_request', error_description: 'code, redirect_uri, and client_id required' });
      }

      const tokens = tokenStore.exchangeAuthCode(code, client_id, redirect_uri);
      if (!tokens) {
        log.warn(`OAuth ← token exchange failed: invalid/expired code=${code.slice(0, 8)}...`);
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
      }

      log.info(`OAuth ← token issued access=${tokens.access_token.slice(0, 8)}... expires_in=${tokens.expires_in}s`);
      return res.json(tokens);
    }

    if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        log.debug(`OAuth ← token rejected: missing refresh_token`);
        return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token required' });
      }

      const tokens = tokenStore.refreshAccessToken(refresh_token);
      if (!tokens) {
        log.warn(`OAuth ← token refresh failed: invalid/expired refresh=${refresh_token.slice(0, 8)}...`);
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' });
      }

      log.info(`OAuth ← token refreshed access=${tokens.access_token.slice(0, 8)}...`);
      return res.json(tokens);
    }

    log.warn(`OAuth ← unsupported grant_type=${grant_type}`);
    res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Supported: authorization_code, refresh_token' });
  };
}

module.exports = createTokenHandler;
