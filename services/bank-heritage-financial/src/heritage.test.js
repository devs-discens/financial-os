const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('./index');

describe('Heritage Financial', () => {
  let server, url;

  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await new Promise(r => server.close(r));
  });

  // Helper: complete MFA OAuth flow
  async function getToken() {
    // Step 1: auto-approve triggers MFA
    const authRes = await fetch(`${url}/oauth/authorize?client_id=fos&redirect_uri=http://localhost/cb&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED+TRANSACTIONS+STATEMENTS+BALANCES+PAYMENT_SUPPORT&state=s1&auto_approve=true`);
    assert.equal(authRes.status, 200);
    const mfaBody = await authRes.json();
    assert.equal(mfaBody.status, 'mfa_required');

    // Step 2: submit MFA code
    const mfaRes = await fetch(`${url}/oauth/authorize/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfa_session: mfaBody.mfa_session, mfa_code: '123456' }),
    });
    const mfaResult = await mfaRes.json();
    assert.ok(mfaResult.code);

    // Step 3: exchange code for token
    const tokenRes = await fetch(`${url}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: mfaResult.code, redirect_uri: 'http://localhost/cb', client_id: 'fos' }),
    });
    return (await tokenRes.json()).access_token;
  }

  it('health check returns heritage-financial', async () => {
    const res = await fetch(`${url}/health`).then(r => r.json());
    assert.equal(res.institution, 'heritage-financial');
  });

  it('well-known returns heritage config', async () => {
    const res = await fetch(`${url}/.well-known/fdx-configuration`).then(r => r.json());
    assert.equal(res.institution_id, 'heritage-financial');
  });

  it('OAuth requires MFA step', async () => {
    const authRes = await fetch(`${url}/oauth/authorize?client_id=fos&redirect_uri=http://localhost/cb&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED&state=s1&auto_approve=true`);
    const body = await authRes.json();
    assert.equal(body.status, 'mfa_required');
    assert.ok(body.mfa_session);
  });

  it('MFA rejects non-6-digit codes', async () => {
    const authRes = await fetch(`${url}/oauth/authorize?client_id=fos&redirect_uri=http://localhost/cb&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED&state=s1&auto_approve=true`);
    const { mfa_session } = await authRes.json();

    const mfaRes = await fetch(`${url}/oauth/authorize/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfa_session, mfa_code: 'abc' }),
    });
    assert.equal(mfaRes.status, 400);
  });

  it('MFA accepts any 6-digit code', async () => {
    const authRes = await fetch(`${url}/oauth/authorize?client_id=fos&redirect_uri=http://localhost/cb&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED&state=s1&auto_approve=true`);
    const { mfa_session } = await authRes.json();

    const mfaRes = await fetch(`${url}/oauth/authorize/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfa_session, mfa_code: '999999' }),
    });
    const result = await mfaRes.json();
    assert.ok(result.code);
  });

  it('has 2 accounts: mortgage and HELOC', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(res.accounts.length, 2);
    const ids = res.accounts.map(a => a.accountId).sort();
    assert.deepEqual(ids, ['htg-heloc-001', 'htg-mtg-001']);
  });

  it('mortgage has correct details', async () => {
    const token = await getToken();
    const acct = await fetch(`${url}/fdx/v6/accounts/htg-mtg-001`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(acct.accountType, 'MORTGAGE');
    assert.equal(acct.principalBalance, 385000);
    assert.equal(acct.interestRate, 4.89);
    assert.equal(acct.compounding, 'SEMI_ANNUAL');
    assert.ok(acct.termEndDate);
  });

  it('HELOC has zero balance and credit limit', async () => {
    const token = await getToken();
    const acct = await fetch(`${url}/fdx/v6/accounts/htg-heloc-001`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(acct.accountType, 'LINE_OF_CREDIT');
    assert.equal(acct.currentBalance, 0);
    assert.equal(acct.creditLimit, 15000);
    assert.equal(acct.availableCredit, 15000);
  });

  it('mortgage statements contain amortization data', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts/htg-mtg-001/statements`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.ok(res.statements.length > 0, 'Should have statement history');

    const first = res.statements[0];
    assert.ok(first.statementId);
    assert.ok(first.principalPayment > 0);
    assert.ok(first.interestPayment > 0);
    assert.ok(first.remainingBalance > 0);
    assert.equal(first.monthlyPayment, 2547.32);
  });

  it('mortgage has no transaction history (balance changes only)', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts/htg-mtg-001/transactions`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(res.transactions.length, 0);
  });

  it('FDX responses are slow (500-2000ms)', async () => {
    const token = await getToken();
    const start = Date.now();
    await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 400, `Response too fast: ${elapsed}ms (expected >= 500ms)`);
  });
});
