const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createFdxServer = require('./fdx-server');

describe('createFdxServer', () => {
  let httpServer;

  afterEach(async () => {
    if (httpServer) await new Promise(r => httpServer.close(r));
    httpServer = null;
  });

  it('creates a working server with accounts', async () => {
    const { app, accountStore } = createFdxServer({
      institutionId: 'test-bank',
      institutionName: 'Test Bank',
      port: 0,
      setupAccounts(store, TxGen) {
        store.addAccount({
          accountId: 'acct-1',
          accountCategory: 'DEPOSIT_ACCOUNT',
          accountType: 'CHECKING',
          displayName: 'Test Account',
          currentBalance: 1000,
        });
        const gen = new TxGen('test-seed');
        const txs = gen.generateHistory('acct-1', [
          { type: 'fixed_recurring', category: 'utilities', amount: 100, dayOfMonth: 1 },
        ], { months: 2 });
        store.addTransactions('acct-1', txs);
      },
    });

    httpServer = http.createServer(app);
    await new Promise(resolve => httpServer.listen(0, resolve));
    const port = httpServer.address().port;
    const url = `http://localhost:${port}`;

    // Health check
    const health = await fetch(`${url}/health`).then(r => r.json());
    assert.equal(health.status, 'ok');
    assert.equal(health.institution, 'test-bank');

    // Well-known
    const wk = await fetch(`${url}/.well-known/fdx-configuration`).then(r => r.json());
    assert.equal(wk.institution_id, 'test-bank');

    // OAuth: auto-approve
    const authRes = await fetch(`${url}/oauth/authorize?client_id=fos&redirect_uri=http://localhost/cb&scope=ACCOUNT_DETAILED+TRANSACTIONS+BALANCES+PAYMENT_SUPPORT+ACCOUNT_BASIC+STATEMENTS&state=s1&auto_approve=true`, { redirect: 'manual' });
    assert.equal(authRes.status, 302);
    const location = new URL(authRes.headers.get('location'));
    const code = location.searchParams.get('code');
    assert.ok(code);

    // Token exchange
    const tokenRes = await fetch(`${url}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost/cb', client_id: 'fos' }),
    });
    const tokens = await tokenRes.json();
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);

    // List accounts
    const accts = await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then(r => r.json());
    assert.equal(accts.accounts.length, 1);
    assert.equal(accts.accounts[0].accountId, 'acct-1');

    // Get transactions
    const txs = await fetch(`${url}/fdx/v6/accounts/acct-1/transactions`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then(r => r.json());
    assert.equal(txs.transactions.length, 2);

    // Failure injection
    await fetch(`${url}/admin/failure/outage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1.0 }),
    });
    const failRes = await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(failRes.status, 503);

    // Clear failure
    await fetch(`${url}/admin/failure/outage`, { method: 'DELETE' });
    const okRes = await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(okRes.status, 200);
  });

  it('supports MFA flow', async () => {
    const { app } = createFdxServer({
      institutionId: 'mfa-bank',
      institutionName: 'MFA Bank',
      port: 0,
      mfaRequired: true,
      setupAccounts(store) {
        store.addAccount({ accountId: 'mfa-1', accountCategory: 'LOAN_ACCOUNT', accountType: 'MORTGAGE', displayName: 'Mortgage' });
      },
    });

    httpServer = http.createServer(app);
    await new Promise(resolve => httpServer.listen(0, resolve));
    const port = httpServer.address().port;
    const url = `http://localhost:${port}`;

    // Auto-approve with MFA
    const authRes = await fetch(`${url}/oauth/authorize?client_id=fos&redirect_uri=http://localhost/cb&scope=ACCOUNT_DETAILED+ACCOUNT_BASIC&state=s1&auto_approve=true`);
    assert.equal(authRes.status, 200);
    const mfaBody = await authRes.json();
    assert.equal(mfaBody.status, 'mfa_required');
    assert.ok(mfaBody.mfa_session);

    // Submit MFA code
    const mfaRes = await fetch(`${url}/oauth/authorize/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfa_session: mfaBody.mfa_session, mfa_code: '123456' }),
    });
    const mfaResult = await mfaRes.json();
    assert.ok(mfaResult.code);

    // Exchange code for token
    const tokenRes = await fetch(`${url}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: mfaResult.code, redirect_uri: 'http://localhost/cb', client_id: 'fos' }),
    });
    const tokens = await tokenRes.json();
    assert.ok(tokens.access_token);

    // List accounts with token
    const accts = await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then(r => r.json());
    assert.equal(accts.accounts.length, 1);
  });
});
