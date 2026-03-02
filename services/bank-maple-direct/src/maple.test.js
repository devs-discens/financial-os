const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('./index');

describe('Maple Direct Bank', () => {
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

  it('health check returns maple-direct', async () => {
    const res = await fetch(`${url}/health`).then(r => r.json());
    assert.equal(res.institution, 'maple-direct');
  });

  it('well-known returns maple-direct config', async () => {
    const res = await fetch(`${url}/.well-known/fdx-configuration`).then(r => r.json());
    assert.equal(res.institution_id, 'maple-direct');
    assert.equal(res.institution_name, 'Maple Direct');
  });

  it('OAuth flow works (auto-approve, no MFA)', async () => {
    const token = await getToken();
    assert.ok(token);
  });

  it('has 3 accounts: chequing, Visa, Mastercard', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(res.accounts.length, 3);
    const ids = res.accounts.map(a => a.accountId).sort();
    assert.deepEqual(ids, ['mpl-chq-001', 'mpl-mc-001', 'mpl-visa-001']);
  });

  it('chequing account has correct details', async () => {
    const token = await getToken();
    const acct = await fetch(`${url}/fdx/v6/accounts/mpl-chq-001`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(acct.accountType, 'CHECKING');
    assert.equal(acct.currentBalance, 4200);
    assert.equal(acct.currency, 'CAD');
    assert.equal(acct.displayName, 'Maple Direct Chequing');
  });

  it('Visa has credit limit and balance', async () => {
    const token = await getToken();
    const acct = await fetch(`${url}/fdx/v6/accounts/mpl-visa-001`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(acct.accountType, 'CREDIT_CARD');
    assert.equal(acct.currentBalance, 2800);
    assert.equal(acct.creditLimit, 10000);
  });

  it('chequing has transaction history with income and debits', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts/mpl-chq-001/transactions`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.ok(res.transactions.length > 0, 'Should have transactions');
    const types = new Set(res.transactions.map(t => t.transactionType));
    assert.ok(types.has('CREDIT'), 'Should have income (CREDIT)');
    assert.ok(types.has('DEBIT'), 'Should have expenses (DEBIT)');
  });

  it('transactions are reproducible (same seed)', async () => {
    const token1 = await getToken();
    const token2 = await getToken();

    const txs1 = await fetch(`${url}/fdx/v6/accounts/mpl-chq-001/transactions?limit=5`, {
      headers: { Authorization: `Bearer ${token1}` },
    }).then(r => r.json());

    const txs2 = await fetch(`${url}/fdx/v6/accounts/mpl-chq-001/transactions?limit=5`, {
      headers: { Authorization: `Bearer ${token2}` },
    }).then(r => r.json());

    assert.equal(txs1.transactions.length, txs2.transactions.length);
    for (let i = 0; i < txs1.transactions.length; i++) {
      assert.equal(txs1.transactions[i].amount, txs2.transactions[i].amount);
      assert.equal(txs1.transactions[i].description, txs2.transactions[i].description);
    }
  });

  it('pagination works for transactions', async () => {
    const token = await getToken();
    const page1 = await fetch(`${url}/fdx/v6/accounts/mpl-chq-001/transactions?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(page1.transactions.length, 5);
    assert.ok(page1.page.nextOffset);

    const page2 = await fetch(`${url}/fdx/v6/accounts/mpl-chq-001/transactions?limit=5&offset=${page1.page.nextOffset}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    assert.equal(page2.transactions.length, 5);
    // No overlap
    const ids1 = page1.transactions.map(t => t.transactionId);
    const ids2 = page2.transactions.map(t => t.transactionId);
    for (const id of ids2) {
      assert.ok(!ids1.includes(id), 'Pages should not overlap');
    }
  });

  it('date filtering works', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts/mpl-chq-001/transactions?startTime=2025-12-01&endTime=2026-01-01`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    for (const tx of res.transactions) {
      const d = new Date(tx.transactionTimestamp);
      assert.ok(d >= new Date('2025-12-01'));
      assert.ok(d <= new Date('2026-01-01'));
    }
  });

  it('payment networks returns EFT/Interac for chequing', async () => {
    const token = await getToken();
    const res = await fetch(`${url}/fdx/v6/accounts/mpl-chq-001/payment-networks`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    const types = res.paymentNetworks.map(n => n.type);
    assert.ok(types.includes('EFT'));
    assert.ok(types.includes('INTERAC'));
  });

  it('failure injection works', async () => {
    const token = await getToken();

    // Activate rate limit
    await fetch(`${url}/admin/failure/rate-limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1.0 }),
    });

    const res = await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 429);

    // Clear
    await fetch(`${url}/admin/failure/rate-limit`, { method: 'DELETE' });
    const res2 = await fetch(`${url}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res2.status, 200);
  });
});
