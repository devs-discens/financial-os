const { v4: uuidv4 } = require('uuid');
const { TOKEN_TTL } = require('../constants');

class TokenStore {
  constructor(log) {
    this.log = log || { debug() {}, info() {}, warn() {}, error() {} };
    this.authCodes = new Map();     // code -> { clientId, redirectUri, scopes, expiresAt, consentId }
    this.accessTokens = new Map();  // token -> { clientId, scopes, expiresAt, consentId }
    this.refreshTokens = new Map(); // token -> { clientId, scopes, expiresAt, consentId, accessToken }
    this.consents = new Map();      // consentId -> { clientId, scopes, createdAt, expiresAt, revoked }
  }

  createConsent(clientId, scopes, userId = null, accountIds = null) {
    const consentId = uuidv4();
    this.consents.set(consentId, {
      clientId,
      scopes,
      userId,
      accountIds,
      createdAt: Date.now(),
      expiresAt: Date.now() + TOKEN_TTL.CONSENT_MS,
      revoked: false,
    });
    this.log.debug(`TokenStore → consent created id=${consentId.slice(0, 8)}... client=${clientId} scopes=${scopes} userId=${userId} accountIds=${accountIds}`);
    return consentId;
  }

  createAuthCode(clientId, redirectUri, scopes, consentId) {
    const code = uuidv4();
    this.authCodes.set(code, {
      clientId,
      redirectUri,
      scopes,
      consentId,
      expiresAt: Date.now() + TOKEN_TTL.AUTH_CODE_MS,
    });
    this.log.debug(`TokenStore → auth_code created code=${code.slice(0, 8)}... client=${clientId}`);
    return code;
  }

  exchangeAuthCode(code, clientId, redirectUri) {
    const entry = this.authCodes.get(code);
    if (!entry) {
      this.log.debug(`TokenStore ← auth_code exchange failed: code not found`);
      return null;
    }
    this.authCodes.delete(code);

    if (entry.clientId !== clientId) {
      this.log.debug(`TokenStore ← auth_code exchange failed: client_id mismatch`);
      return null;
    }
    if (entry.redirectUri !== redirectUri) {
      this.log.debug(`TokenStore ← auth_code exchange failed: redirect_uri mismatch`);
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.log.debug(`TokenStore ← auth_code exchange failed: code expired`);
      return null;
    }

    const consent = this.consents.get(entry.consentId);
    if (!consent || consent.revoked) {
      this.log.debug(`TokenStore ← auth_code exchange failed: consent revoked or missing`);
      return null;
    }

    const tokens = this._issueTokenPair(clientId, entry.scopes, entry.consentId);
    this.log.debug(`TokenStore ← auth_code exchanged → access=${tokens.access_token.slice(0, 8)}... refresh=${tokens.refresh_token.slice(0, 8)}...`);
    return tokens;
  }

  refreshAccessToken(refreshToken) {
    const entry = this.refreshTokens.get(refreshToken);
    if (!entry) {
      this.log.debug(`TokenStore ← refresh failed: token not found`);
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.refreshTokens.delete(refreshToken);
      this.log.debug(`TokenStore ← refresh failed: token expired`);
      return null;
    }

    const consent = this.consents.get(entry.consentId);
    if (!consent || consent.revoked) {
      this.log.debug(`TokenStore ← refresh failed: consent revoked`);
      return null;
    }

    // Revoke old access token
    this.accessTokens.delete(entry.accessToken);
    this.refreshTokens.delete(refreshToken);

    const tokens = this._issueTokenPair(entry.clientId, entry.scopes, entry.consentId);
    this.log.debug(`TokenStore ← token refreshed → access=${tokens.access_token.slice(0, 8)}...`);
    return tokens;
  }

  validateAccessToken(token) {
    const entry = this.accessTokens.get(token);
    if (!entry) {
      this.log.debug(`TokenStore ← validate failed: token not found`);
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.accessTokens.delete(token);
      this.log.debug(`TokenStore ← validate failed: token expired`);
      return null;
    }

    const consent = this.consents.get(entry.consentId);
    if (!consent || consent.revoked) {
      this.log.debug(`TokenStore ← validate failed: consent revoked`);
      return null;
    }

    this.log.debug(`TokenStore ← validate ok token=${token.slice(0, 8)}... scopes=${entry.scopes} userId=${entry.userId} accountIds=${entry.accountIds}`);
    return { clientId: entry.clientId, scopes: entry.scopes, consentId: entry.consentId, userId: entry.userId, accountIds: entry.accountIds };
  }

  revokeToken(token) {
    if (this.accessTokens.has(token)) {
      this.accessTokens.delete(token);
      this.log.debug(`TokenStore → access token revoked ${token.slice(0, 8)}...`);
      return true;
    }
    if (this.refreshTokens.has(token)) {
      const entry = this.refreshTokens.get(token);
      this.accessTokens.delete(entry.accessToken);
      this.refreshTokens.delete(token);
      this.log.debug(`TokenStore → refresh token revoked ${token.slice(0, 8)}... (+ paired access token)`);
      return true;
    }
    this.log.debug(`TokenStore → revoke: token not found`);
    return false;
  }

  revokeConsent(consentId) {
    const consent = this.consents.get(consentId);
    if (!consent) return false;
    consent.revoked = true;
    let cleaned = 0;
    for (const [token, entry] of this.accessTokens) {
      if (entry.consentId === consentId) { this.accessTokens.delete(token); cleaned++; }
    }
    for (const [token, entry] of this.refreshTokens) {
      if (entry.consentId === consentId) { this.refreshTokens.delete(token); cleaned++; }
    }
    this.log.info(`TokenStore → consent revoked id=${consentId.slice(0, 8)}... (cleaned ${cleaned} tokens)`);
    return true;
  }

  _issueTokenPair(clientId, scopes, consentId) {
    const accessToken = uuidv4();
    const refreshToken = uuidv4();
    const consent = this.consents.get(consentId);
    const userId = consent ? consent.userId : null;
    const accountIds = consent ? consent.accountIds : null;

    this.accessTokens.set(accessToken, {
      clientId,
      scopes,
      consentId,
      userId,
      accountIds,
      expiresAt: Date.now() + TOKEN_TTL.ACCESS_TOKEN_MS,
    });

    this.refreshTokens.set(refreshToken, {
      clientId,
      scopes,
      consentId,
      userId,
      accountIds,
      accessToken,
      expiresAt: Date.now() + TOKEN_TTL.REFRESH_TOKEN_MS,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: Math.floor(TOKEN_TTL.ACCESS_TOKEN_MS / 1000),
      scope: scopes.join(' '),
    };
  }
}

module.exports = TokenStore;
