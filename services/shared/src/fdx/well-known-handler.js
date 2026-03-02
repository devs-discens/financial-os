function createWellKnownHandler({ institutionId, institutionName, baseUrl, log }) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };

  return function wellKnownHandler(req, res) {
    log.debug(`FDX → .well-known/fdx-configuration requested`);
    const config = {
      fdx_version: '6.0',
      institution_id: institutionId,
      institution_name: institutionName,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      revocation_endpoint: `${baseUrl}/oauth/revoke`,
      accounts_endpoint: `${baseUrl}/fdx/v6/accounts`,
      scopes_supported: [
        'ACCOUNT_BASIC',
        'ACCOUNT_DETAILED',
        'TRANSACTIONS',
        'STATEMENTS',
        'BALANCES',
        'PAYMENT_SUPPORT',
      ],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    };
    log.debug(`FDX ← .well-known served: version=${config.fdx_version} scopes=${config.scopes_supported.length}`);
    res.json(config);
  };
}

module.exports = createWellKnownHandler;
