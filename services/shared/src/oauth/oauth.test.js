const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const TokenStore = require('./token-store');

describe('TokenStore', () => {
  let store;

  beforeEach(() => {
    store = new TokenStore();
  });

  describe('consent + auth code flow', () => {
    it('creates consent and auth code', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      assert.ok(consentId);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);
      assert.ok(code);
    });

    it('exchanges auth code for tokens', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);

      const tokens = store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');
      assert.ok(tokens);
      assert.ok(tokens.access_token);
      assert.ok(tokens.refresh_token);
      assert.equal(tokens.token_type, 'Bearer');
      assert.equal(tokens.scope, 'ACCOUNT_DETAILED');
      assert.ok(tokens.expires_in > 0);
    });

    it('rejects auth code with wrong client_id', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);

      const tokens = store.exchangeAuthCode(code, 'wrong-client', 'http://localhost/cb');
      assert.equal(tokens, null);
    });

    it('rejects auth code with wrong redirect_uri', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);

      const tokens = store.exchangeAuthCode(code, 'client1', 'http://wrong/cb');
      assert.equal(tokens, null);
    });

    it('prevents auth code reuse', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);

      store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');
      const second = store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');
      assert.equal(second, null);
    });
  });

  describe('access token validation', () => {
    it('validates a valid access token', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED', 'TRANSACTIONS']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED', 'TRANSACTIONS'], consentId);
      const tokens = store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');

      const info = store.validateAccessToken(tokens.access_token);
      assert.ok(info);
      assert.equal(info.clientId, 'client1');
      assert.deepEqual(info.scopes, ['ACCOUNT_DETAILED', 'TRANSACTIONS']);
    });

    it('rejects unknown token', () => {
      assert.equal(store.validateAccessToken('nonexistent'), null);
    });
  });

  describe('refresh token', () => {
    it('refreshes an access token', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);
      const tokens = store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');

      const newTokens = store.refreshAccessToken(tokens.refresh_token);
      assert.ok(newTokens);
      assert.ok(newTokens.access_token !== tokens.access_token);
      assert.ok(newTokens.refresh_token !== tokens.refresh_token);
    });

    it('invalidates old access token after refresh', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);
      const tokens = store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');

      store.refreshAccessToken(tokens.refresh_token);
      assert.equal(store.validateAccessToken(tokens.access_token), null);
    });

    it('prevents refresh token reuse', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);
      const tokens = store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');

      store.refreshAccessToken(tokens.refresh_token);
      assert.equal(store.refreshAccessToken(tokens.refresh_token), null);
    });
  });

  describe('revocation', () => {
    it('revokes an access token', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);
      const tokens = store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');

      assert.ok(store.revokeToken(tokens.access_token));
      assert.equal(store.validateAccessToken(tokens.access_token), null);
    });

    it('revokes a refresh token and its access token', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);
      const tokens = store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');

      assert.ok(store.revokeToken(tokens.refresh_token));
      assert.equal(store.validateAccessToken(tokens.access_token), null);
    });

    it('revokes consent and invalidates all tokens', () => {
      const consentId = store.createConsent('client1', ['ACCOUNT_DETAILED']);
      const code = store.createAuthCode('client1', 'http://localhost/cb', ['ACCOUNT_DETAILED'], consentId);
      const tokens = store.exchangeAuthCode(code, 'client1', 'http://localhost/cb');

      store.revokeConsent(consentId);
      assert.equal(store.validateAccessToken(tokens.access_token), null);
    });
  });
});
