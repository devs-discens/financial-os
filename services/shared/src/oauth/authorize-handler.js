const { OAUTH_SCOPES } = require('../constants');

function createAuthorizeHandlers(tokenStore, { institutionName, mfaRequired, log } = {}) {
  log = log || { debug() {}, info() {}, warn() {}, error() {} };
  // Pending MFA sessions: sessionId -> { clientId, redirectUri, scopes, state, consentId }
  const mfaSessions = new Map();

  function getAuthorize(req, res) {
    const { client_id, redirect_uri, scope, state, auto_approve, user_id, account_ids } = req.query;
    log.debug(`OAuth → authorize client=${client_id} scope=${scope} auto_approve=${auto_approve} user_id=${user_id || 'none'} account_ids=${account_ids || 'all'}`);

    if (!client_id || !redirect_uri) {
      log.debug(`OAuth ← authorize rejected: missing client_id or redirect_uri`);
      return res.status(400).json({ error: 'invalid_request', error_description: 'client_id and redirect_uri required' });
    }

    const scopes = scope ? scope.split(/[+ ]/).filter(s => OAUTH_SCOPES.includes(s)) : [];
    if (scopes.length === 0) {
      log.debug(`OAuth ← authorize rejected: no valid scopes in "${scope}"`);
      return res.status(400).json({ error: 'invalid_scope', error_description: `Valid scopes: ${OAUTH_SCOPES.join(', ')}` });
    }

    // Parse account_ids (comma-separated string → array, or null for all)
    const accountIds = account_ids ? account_ids.split(',').map(s => s.trim()).filter(Boolean) : null;

    // Auto-approve mode for testing
    if (auto_approve === 'true') {
      const consentId = tokenStore.createConsent(client_id, scopes, user_id || null, accountIds);

      if (mfaRequired) {
        const { v4: uuidv4 } = require('uuid');
        const sessionId = uuidv4();
        mfaSessions.set(sessionId, { clientId: client_id, redirectUri: redirect_uri, scopes, state, consentId, userId: user_id || null, accountIds });
        log.info(`OAuth ← mfa_required session=${sessionId.slice(0, 8)}... scopes=${scopes}`);
        return res.json({
          status: 'mfa_required',
          mfa_session: sessionId,
          message: 'Enter 6-digit MFA code via POST /oauth/authorize/mfa',
        });
      }

      const code = tokenStore.createAuthCode(client_id, redirect_uri, scopes, consentId);
      log.info(`OAuth ← authorize approved (auto) code=${code.slice(0, 8)}... scopes=${scopes}`);
      const url = new URL(redirect_uri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);
      return res.redirect(302, url.toString());
    }

    // Consent screen HTML
    log.debug(`OAuth ← serving consent screen for ${institutionName}`);
    const name = institutionName || 'Financial Institution';
    res.send(`<!DOCTYPE html>
<html><head><title>${name} — Authorize</title></head>
<body>
  <h1>${name}</h1>
  <p>Financial OS is requesting access to:</p>
  <ul>${scopes.map(s => `<li>${s}</li>`).join('')}</ul>
  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="client_id" value="${client_id}" />
    <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
    <input type="hidden" name="scope" value="${scopes.join(' ')}" />
    <input type="hidden" name="state" value="${state || ''}" />
    <input type="hidden" name="account_ids" value="${accountIds ? accountIds.join(',') : ''}" />
    <button type="submit" name="action" value="approve">Approve</button>
    <button type="submit" name="action" value="deny">Deny</button>
  </form>
</body></html>`);
  }

  function postAuthorize(req, res) {
    const { client_id, redirect_uri, scope, state, action } = req.body;
    log.debug(`OAuth → postAuthorize client=${client_id} action=${action}`);

    if (action === 'deny') {
      log.info(`OAuth ← authorize denied by user client=${client_id}`);
      const url = new URL(redirect_uri);
      url.searchParams.set('error', 'access_denied');
      if (state) url.searchParams.set('state', state);
      return res.redirect(302, url.toString());
    }

    const scopes = scope ? scope.split(' ').filter(s => OAUTH_SCOPES.includes(s)) : [];
    const userId = req.body.user_id || null;
    const rawAccountIds = req.body.account_ids || null;
    const accountIds = rawAccountIds ? rawAccountIds.split(',').map(s => s.trim()).filter(Boolean) : null;
    const consentId = tokenStore.createConsent(client_id, scopes, userId, accountIds);

    if (mfaRequired) {
      const { v4: uuidv4 } = require('uuid');
      const sessionId = uuidv4();
      mfaSessions.set(sessionId, { clientId: client_id, redirectUri: redirect_uri, scopes, state, consentId, userId, accountIds });
      log.info(`OAuth ← mfa_required (post) session=${sessionId.slice(0, 8)}...`);
      return res.json({
        status: 'mfa_required',
        mfa_session: sessionId,
        message: 'Enter 6-digit MFA code via POST /oauth/authorize/mfa',
      });
    }

    const code = tokenStore.createAuthCode(client_id, redirect_uri, scopes, consentId);
    log.info(`OAuth ← authorize approved (post) code=${code.slice(0, 8)}...`);
    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    res.redirect(302, url.toString());
  }

  function postMfa(req, res) {
    const { mfa_session, mfa_code } = req.body;
    log.debug(`OAuth → mfa_submit session=${mfa_session?.slice(0, 8)}... code_length=${mfa_code?.length}`);

    const session = mfaSessions.get(mfa_session);
    if (!session) {
      log.warn(`OAuth ← mfa_submit failed: invalid session`);
      return res.status(400).json({ error: 'invalid_request', error_description: 'Invalid MFA session' });
    }

    // Accept any 6-digit code or the magic code 123456
    if (!/^\d{6}$/.test(mfa_code)) {
      log.warn(`OAuth ← mfa_submit failed: code not 6 digits`);
      return res.status(400).json({ error: 'invalid_mfa', error_description: 'MFA code must be 6 digits' });
    }

    mfaSessions.delete(mfa_session);

    const code = tokenStore.createAuthCode(session.clientId, session.redirectUri, session.scopes, session.consentId);
    log.info(`OAuth ← mfa_verified → code=${code.slice(0, 8)}...`);
    const url = new URL(session.redirectUri);
    url.searchParams.set('code', code);
    if (session.state) url.searchParams.set('state', session.state);
    res.json({ redirect_uri: url.toString(), code });
  }

  return { getAuthorize, postAuthorize, postMfa, mfaSessions };
}

module.exports = createAuthorizeHandlers;
