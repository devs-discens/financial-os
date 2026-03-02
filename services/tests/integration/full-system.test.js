const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

describe('Full System Integration', () => {
  const services = {};

  before(async () => {
    // Start all 4 services in-process on random ports
    const { app: mapleApp } = require('../../bank-maple-direct/src/index');
    const { app: heritageApp } = require('../../bank-heritage-financial/src/index');
    const { app: frontierApp } = require('../../bank-frontier-business/src/index');
    const { app: registryApp } = require('../../registry/src/index');

    for (const [name, a] of [['maple', mapleApp], ['heritage', heritageApp], ['frontier', frontierApp], ['registry', registryApp]]) {
      const server = http.createServer(a);
      await new Promise(resolve => server.listen(0, resolve));
      services[name] = { server, url: `http://localhost:${server.address().port}` };
    }
  });

  after(async () => {
    for (const svc of Object.values(services)) {
      await new Promise(r => svc.server.close(r));
    }
  });

  // Helper: standard OAuth flow (no MFA)
  async function getToken(baseUrl) {
    const authRes = await fetch(
      `${baseUrl}/oauth/authorize?client_id=financial-os&redirect_uri=http://localhost:8100/callback&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED+TRANSACTIONS+STATEMENTS+BALANCES+PAYMENT_SUPPORT&state=test&auto_approve=true`,
      { redirect: 'manual' }
    );
    const location = new URL(authRes.headers.get('location'));
    const code = location.searchParams.get('code');

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:8100/callback',
        client_id: 'financial-os',
      }),
    });
    return await tokenRes.json();
  }

  // Helper: MFA OAuth flow
  async function getTokenMfa(baseUrl) {
    const authRes = await fetch(
      `${baseUrl}/oauth/authorize?client_id=financial-os&redirect_uri=http://localhost:8100/callback&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED+TRANSACTIONS+STATEMENTS+BALANCES+PAYMENT_SUPPORT&state=test&auto_approve=true`
    );
    const mfaBody = await authRes.json();

    const mfaRes = await fetch(`${baseUrl}/oauth/authorize/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfa_session: mfaBody.mfa_session, mfa_code: '123456' }),
    });
    const { code } = await mfaRes.json();

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:8100/callback',
        client_id: 'financial-os',
      }),
    });
    return await tokenRes.json();
  }

  describe('All services health', () => {
    it('all 4 services respond to health check', async () => {
      for (const [name, svc] of Object.entries(services)) {
        const res = await fetch(`${svc.url}/health`);
        assert.equal(res.status, 200, `${name} health check failed`);
      }
    });
  });

  describe('Registry', () => {
    it('lists all 3 institutions', async () => {
      const res = await fetch(`${services.registry.url}/registry/institutions`).then(r => r.json());
      assert.equal(res.total, 3);
    });
  });

  describe('Maple Direct — Full OAuth + FDX flow', () => {
    it('completes full OAuth authorization_code flow', async () => {
      const tokens = await getToken(services.maple.url);
      assert.ok(tokens.access_token);
      assert.ok(tokens.refresh_token);
      assert.equal(tokens.token_type, 'Bearer');
    });

    it('lists 3 accounts with correct Alex Chen data', async () => {
      const tokens = await getToken(services.maple.url);
      const res = await fetch(`${services.maple.url}/fdx/v6/accounts`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then(r => r.json());

      assert.equal(res.accounts.length, 3);
      const chequing = res.accounts.find(a => a.accountId === 'mpl-chq-001');
      assert.equal(chequing.currentBalance, 4200);
      assert.equal(chequing.currency, 'CAD');
    });

    it('paginates transactions correctly', async () => {
      const tokens = await getToken(services.maple.url);
      const page1 = await fetch(`${services.maple.url}/fdx/v6/accounts/mpl-chq-001/transactions?limit=10`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then(r => r.json());

      assert.equal(page1.transactions.length, 10);
      assert.ok(page1.page.nextOffset);
      assert.ok(page1.page.totalElements > 10);

      const page2 = await fetch(`${services.maple.url}/fdx/v6/accounts/mpl-chq-001/transactions?limit=10&offset=${page1.page.nextOffset}`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then(r => r.json());

      assert.equal(page2.transactions.length, 10);
      // No overlap between pages
      const ids1 = new Set(page1.transactions.map(t => t.transactionId));
      for (const tx of page2.transactions) {
        assert.ok(!ids1.has(tx.transactionId), 'Pages should not overlap');
      }
    });

    it('refreshes token and old token is invalidated', async () => {
      const tokens = await getToken(services.maple.url);

      // Refresh
      const refreshRes = await fetch(`${services.maple.url}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
      }).then(r => r.json());

      assert.ok(refreshRes.access_token);
      assert.notEqual(refreshRes.access_token, tokens.access_token);

      // Old token should be invalid
      const oldRes = await fetch(`${services.maple.url}/fdx/v6/accounts`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      assert.equal(oldRes.status, 401);

      // New token should work
      const newRes = await fetch(`${services.maple.url}/fdx/v6/accounts`, {
        headers: { Authorization: `Bearer ${refreshRes.access_token}` },
      });
      assert.equal(newRes.status, 200);
    });

    it('revokes token', async () => {
      const tokens = await getToken(services.maple.url);

      await fetch(`${services.maple.url}/oauth/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokens.access_token }),
      });

      const res = await fetch(`${services.maple.url}/fdx/v6/accounts`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      assert.equal(res.status, 401);
    });
  });

  describe('Heritage Financial — MFA + Mortgage', () => {
    it('requires MFA during OAuth', async () => {
      const authRes = await fetch(
        `${services.heritage.url}/oauth/authorize?client_id=financial-os&redirect_uri=http://localhost:8100/callback&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED&state=test&auto_approve=true`
      );
      const body = await authRes.json();
      assert.equal(body.status, 'mfa_required');
    });

    it('completes MFA flow and accesses accounts', async () => {
      const tokens = await getTokenMfa(services.heritage.url);
      const res = await fetch(`${services.heritage.url}/fdx/v6/accounts`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then(r => r.json());

      assert.equal(res.accounts.length, 2);
    });

    it('mortgage statements have amortization data', async () => {
      const tokens = await getTokenMfa(services.heritage.url);
      const res = await fetch(`${services.heritage.url}/fdx/v6/accounts/htg-mtg-001/statements`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then(r => r.json());

      assert.ok(res.statements.length > 0);
      const stmt = res.statements[0];
      assert.ok(stmt.principalPayment > 0);
      assert.ok(stmt.interestPayment > 0);
    });
  });

  describe('Frontier Business — Irregular Income', () => {
    it('completes OAuth and accesses 2 business accounts', async () => {
      const tokens = await getToken(services.frontier.url);
      const res = await fetch(`${services.frontier.url}/fdx/v6/accounts`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then(r => r.json());

      assert.equal(res.accounts.length, 2);
      const biz = res.accounts.find(a => a.accountId === 'frt-biz-chq-001');
      assert.equal(biz.businessName, 'Chen Consulting Inc.');
    });

    it('has variable consulting income transactions', async () => {
      const tokens = await getToken(services.frontier.url);
      const res = await fetch(`${services.frontier.url}/fdx/v6/accounts/frt-biz-chq-001/transactions`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then(r => r.json());

      const incomes = res.transactions.filter(t => t.transactionType === 'CREDIT');
      assert.ok(incomes.length >= 12);
      // Check amounts vary (not all the same)
      const amounts = new Set(incomes.map(t => t.amount));
      assert.ok(amounts.size > 1, 'Income amounts should vary');
    });
  });

  describe('Failure Injection', () => {
    it('rate-limit injection returns 429 and can be cleared', async () => {
      const tokens = await getToken(services.maple.url);

      // Activate
      await fetch(`${services.maple.url}/admin/failure/rate-limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: 1.0 }),
      });

      const res = await fetch(`${services.maple.url}/fdx/v6/accounts`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      assert.equal(res.status, 429);

      // Clear
      await fetch(`${services.maple.url}/admin/failure/rate-limit`, { method: 'DELETE' });
      const res2 = await fetch(`${services.maple.url}/fdx/v6/accounts`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      assert.equal(res2.status, 200);
    });

    it('outage injection returns 503', async () => {
      const tokens = await getToken(services.frontier.url);

      await fetch(`${services.frontier.url}/admin/failure/outage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: 1.0 }),
      });

      const res = await fetch(`${services.frontier.url}/fdx/v6/accounts`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      assert.equal(res.status, 503);

      await fetch(`${services.frontier.url}/admin/failure`, { method: 'DELETE' });
    });
  });

  describe('Cross-service: FDX discovery', () => {
    it('all banks expose .well-known/fdx-configuration', async () => {
      for (const [name, svc] of [['maple', services.maple], ['heritage', services.heritage], ['frontier', services.frontier]]) {
        const res = await fetch(`${svc.url}/.well-known/fdx-configuration`).then(r => r.json());
        assert.equal(res.fdx_version, '6.0', `${name} FDX version mismatch`);
        assert.ok(res.authorization_endpoint, `${name} missing auth endpoint`);
        assert.ok(res.token_endpoint, `${name} missing token endpoint`);
        assert.ok(res.accounts_endpoint, `${name} missing accounts endpoint`);
      }
    });
  });

  describe('Error handling', () => {
    it('returns 404 for unknown account', async () => {
      const tokens = await getToken(services.maple.url);
      const res = await fetch(`${services.maple.url}/fdx/v6/accounts/nonexistent`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.code, 701);
    });

    it('returns 401 for invalid token', async () => {
      const res = await fetch(`${services.maple.url}/fdx/v6/accounts`, {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      assert.equal(res.status, 401);
    });

    it('returns 401 for missing auth header', async () => {
      const res = await fetch(`${services.maple.url}/fdx/v6/accounts`);
      assert.equal(res.status, 401);
    });
  });
});
