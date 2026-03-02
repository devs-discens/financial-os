const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('./index');

describe('Frontier Business Banking', () => {
  let server, url;

  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await new Promise(r => server.close(r));
  });

  async function getToken() {
    const authRes = await fetch(`${url}/oauth/authorize?client_id=fos&redirect_uri=http://localhost/cb&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED+TRANSACTIONS+STATEMENTS+BALANCES+PAYMENT_SUPPORT&state=s1&auto_approve=true`, { redirect: 'manual' });
    const location = new URL(authRes.headers.get('location'));
    const code = location.searchParams.get('code');

    const tokenRes = await fetch(`${url}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost/cb', client_id: 'fos' }),
    });
    return (await tokenRes.json()).access_token;
  }

  it('health check returns frontier-business', async () => {
    const res = await fetch(`${url}/health`).then(r => r.json());
    assert.equal(res.institution, 'frontier-business');
  });

  it('well-known returns frontier config', async () => {
    const res = await fetch(`${url}/.well-known/fdx-configuration`).then(r => r.json());
    assert.equal(res.institution_id, 'frontier-business');
  });

  it('OAuth flow works (no MFA)', async () => {
    const token = await getToken();
    assert.ok(token);
  });

  it('has 2 accounts: business chequing and business Visa', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(res.accounts.length, 2);
    const ids = res.accounts.map(a => a.accountId).sort();
    assert.deepEqual(ids, ['frt-biz-chq-001', 'frt-biz-visa-001']);
  });

  it('business chequing has correct details', async () => {
    const token = await getToken();
    const acct = await fetch(`${url}/fdx/v6/accounts/frt-biz-chq-001`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(acct.accountType, 'CHECKING');
    assert.equal(acct.currentBalance, 12400);
    assert.equal(acct.businessName, 'Chen Consulting Inc.');
  });

  it('business Visa has credit limit', async () => {
    const token = await getToken();
    const acct = await fetch(`${url}/fdx/v6/accounts/frt-biz-visa-001`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(acct.accountType, 'CREDIT_CARD');
    assert.equal(acct.currentBalance, 1100);
    assert.equal(acct.creditLimit, 8000);
  });

  it('business chequing has irregular consulting income', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts/frt-biz-chq-001/transactions`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.ok(res.transactions.length > 0);

    const incomes = res.transactions.filter(t => t.transactionType === 'CREDIT');
    assert.ok(incomes.length >= 12, `Expected >= 12 income transactions, got ${incomes.length}`);

    for (const tx of incomes) {
      assert.ok(tx.amount >= 1500, `Income too low: ${tx.amount}`);
      assert.ok(tx.amount <= 6000, `Income too high: ${tx.amount}`);
    }
  });

  it('business Visa has SaaS and client dinner charges', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts/frt-biz-visa-001/transactions`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.ok(res.transactions.length > 0);

    const descriptions = res.transactions.map(t => t.description || t.merchantName || '');
    const hasSaaS = descriptions.some(d => d.includes('Slack') || d.includes('Figma') || d.includes('Adobe'));
    assert.ok(hasSaaS, 'Should have SaaS subscription charges');
  });

  it('transactions are reproducible (same seed)', async () => {
    const token1 = await getToken();
    const token2 = await getToken();

    const txs1 = await fetch(`${url}/fdx/v6/accounts/frt-biz-chq-001/transactions?limit=5`, {
      headers: { Authorization: `Bearer ${token1}` },
    }).then(r => r.json());

    const txs2 = await fetch(`${url}/fdx/v6/accounts/frt-biz-chq-001/transactions?limit=5`, {
      headers: { Authorization: `Bearer ${token2}` },
    }).then(r => r.json());

    for (let i = 0; i < txs1.transactions.length; i++) {
      assert.equal(txs1.transactions[i].amount, txs2.transactions[i].amount);
    }
  });
});
