/**
 * E2E tests for admin demo endpoints.
 * Tests: bulk setup, per-account consent, single connect, reset, transaction injection.
 * Runs against live Docker containers:
 *   - maple-direct:3001, heritage-financial:3002, frontier-business:3003
 *   - registry:3010, orchestrator:3020
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const ORCHESTRATOR = 'http://localhost:3020';
const MAPLE = 'http://localhost:3001';

let adminToken;

async function fetchJSON(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
  const resp = await fetch(url, { ...options, headers });
  const body = await resp.json();
  return { status: resp.status, body };
}

// Fetch without admin auth (for twin queries that resolve user_id from path)
async function fetchAnon(url) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

// OAuth with optional account_ids filter
async function oauthForUser(baseUrl, userId, accountIds = null) {
  let url = `${baseUrl}/oauth/authorize?client_id=financial-os&redirect_uri=http://localhost:8100/callback&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED+TRANSACTIONS+STATEMENTS+BALANCES+PAYMENT_SUPPORT&state=test&auto_approve=true&user_id=${userId}`;
  if (accountIds) url += `&account_ids=${accountIds.join(',')}`;

  const authRes = await fetch(url, { redirect: 'manual' });

  if (authRes.status === 302) {
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
    return tokenRes.json();
  }

  // MFA flow
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
  return tokenRes.json();
}

// ── Setup: login as admin ──

before(async () => {
  const { body } = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  adminToken = body.access_token;
  assert.ok(adminToken, 'Should get admin token');
});

// ── Per-account consent: bank-level filtering ──

describe('Per-account consent: bank-level', () => {
  it('returns only consented accounts when account_ids specified', async () => {
    // Get tokens with consent for only chequing
    const sarahChqId = 'mpl-sarah--chq-001';
    const tokens = await oauthForUser(MAPLE, 'sarah-johnson', [sarahChqId]);

    const res = await fetch(`${MAPLE}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const data = await res.json();

    assert.equal(data.accounts.length, 1, 'Should only see 1 consented account');
    assert.equal(data.accounts[0].accountId, sarahChqId);
  });

  it('returns 403 for non-consented account detail', async () => {
    const sarahChqId = 'mpl-sarah--chq-001';
    const sarahVisaId = 'mpl-sarah--visa-001';
    const tokens = await oauthForUser(MAPLE, 'sarah-johnson', [sarahChqId]);

    // Try to access Visa (not consented)
    const res = await fetch(`${MAPLE}/fdx/v6/accounts/${sarahVisaId}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(res.status, 403, 'Non-consented account should return 403');
  });

  it('returns 403 for transactions on non-consented account', async () => {
    const sarahChqId = 'mpl-sarah--chq-001';
    const sarahVisaId = 'mpl-sarah--visa-001';
    const tokens = await oauthForUser(MAPLE, 'sarah-johnson', [sarahChqId]);

    const res = await fetch(`${MAPLE}/fdx/v6/accounts/${sarahVisaId}/transactions`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(res.status, 403, 'Non-consented account transactions should return 403');
  });

  it('returns all accounts when no account_ids filter', async () => {
    const tokens = await oauthForUser(MAPLE, 'sarah-johnson');

    const res = await fetch(`${MAPLE}/fdx/v6/accounts`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const data = await res.json();

    assert.ok(data.accounts.length >= 2, 'Should see all accounts without filter');
  });
});

// ── Admin Demo: reset + setup ──

describe('Admin Demo: reset and setup', () => {
  it('resets sarah-johnson (clears connections and twin)', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/admin/demo/reset-user/sarah-johnson`, {
      method: 'POST',
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'reset');
    assert.equal(body.user_id, 'sarah-johnson');
  });

  it('connects sarah-johnson to maple-direct with per-account consent', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/admin/demo/connect`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'sarah-johnson',
        institution_id: 'maple-direct',
        account_ids: ['mpl-sarah--chq-001', 'mpl-sarah--visa-001'],
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'connected');
    // Should see exactly 2 accounts (chequing + Visa, no Mastercard)
    assert.equal(body.accounts.length, 2, 'Should have 2 consented accounts');
    const accountIds = body.accounts.map(a => a.account_id).sort();
    assert.ok(accountIds.includes('mpl-sarah--chq-001'), 'Should have chequing');
    assert.ok(accountIds.includes('mpl-sarah--visa-001'), 'Should have Visa');
  });

  it('sarah-johnson twin shows only consented accounts', async () => {
    const { status, body } = await fetchAnon(`${ORCHESTRATOR}/twin/sarah-johnson`);
    assert.equal(status, 200);
    // Only chequing + Visa from Maple (no Mastercard)
    const accountIds = body.accounts.map(a => a.account_id);
    assert.ok(!accountIds.includes('mpl-sarah--mc-001'), 'Twin should NOT have Mastercard');
  });
});

// ── Admin Demo: single connect + already_connected ──

describe('Admin Demo: connect idempotent', () => {
  it('returns already_connected on duplicate connect', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/admin/demo/connect`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'sarah-johnson',
        institution_id: 'maple-direct',
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'already_connected');
  });
});

// ── Admin Demo: Heritage auto-MFA ──

describe('Admin Demo: Heritage auto-MFA', () => {
  it('resets and connects emma-rodriguez to Heritage with mortgage only', async () => {
    // Reset first
    await fetchJSON(`${ORCHESTRATOR}/admin/demo/reset-user/emma-rodriguez`, {
      method: 'POST',
    });

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/admin/demo/connect`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'emma-rodriguez',
        institution_id: 'heritage-financial',
        account_ids: ['htg-emma-r-mtg-001'],
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'connected');
    // Should have only mortgage, not HELOC
    assert.equal(body.accounts.length, 1, 'Should have 1 consented account (mortgage only)');
    assert.equal(body.accounts[0].account_id, 'htg-emma-r-mtg-001');
  });
});

// ── Admin Demo: transaction injection ──

describe('Admin Demo: transaction injection', () => {
  it('injects a transaction and pulls it into twin', async () => {
    // Ensure sarah-johnson is connected to maple
    const connectRes = await fetchJSON(`${ORCHESTRATOR}/admin/demo/connect`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'sarah-johnson',
        institution_id: 'maple-direct',
      }),
    });
    assert.ok(
      connectRes.body.status === 'connected' || connectRes.body.status === 'already_connected',
      'Sarah should be connected',
    );

    // Get current transaction count
    const beforeTxns = await fetchAnon(
      `${ORCHESTRATOR}/twin/sarah-johnson/transactions?account_id=mpl-sarah--chq-001`,
    );
    const beforeCount = beforeTxns.body.transactions?.length || 0;

    // Inject a transaction
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/admin/demo/inject-transaction`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'sarah-johnson',
        institution_id: 'maple-direct',
        account_id: 'mpl-sarah--chq-001',
        description: 'Test Coffee Shop',
        amount: 4.25,
        transaction_type: 'DEBIT',
        category: 'FOOD',
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'injected');
    assert.ok(body.transaction, 'Should return the injected transaction');
    assert.equal(body.transaction.description, 'Test Coffee Shop');

    // Verify transaction appears in twin
    const afterTxns = await fetchAnon(
      `${ORCHESTRATOR}/twin/sarah-johnson/transactions?account_id=mpl-sarah--chq-001`,
    );
    const afterCount = afterTxns.body.transactions?.length || 0;
    assert.ok(afterCount > beforeCount, 'Transaction count should increase after injection');
  });
});

// ── Admin Demo: demo users endpoint ──

describe('Admin Demo: users endpoint', () => {
  it('returns all seed users with personas and bank status', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/admin/demo/users`);
    assert.equal(status, 200);
    assert.ok(body.users.length >= 5, 'Should have at least 5 demo users');

    const sarah = body.users.find(u => u.user_id === 'sarah-johnson');
    assert.ok(sarah, 'Should include sarah-johnson');
    assert.ok(sarah.persona, 'Should have a persona');
    assert.ok(sarah.banks.length > 0, 'Should have bank configs');
  });
});

// ── Admin Demo: bulk setup (idempotent) ──

describe('Admin Demo: bulk setup', () => {
  it('setup is idempotent — running twice does not duplicate', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/admin/demo/setup`, {
      method: 'POST',
    });
    assert.equal(status, 200);
    assert.ok(body.users.length > 0, 'Should have user results');

    // All should be either connected or already_connected
    for (const user of body.users) {
      for (const conn of user.connections) {
        assert.ok(
          conn.status === 'connected' || conn.status === 'already_connected',
          `${user.user_id}/${conn.institution_id} should be connected or already_connected, got ${conn.status}`,
        );
      }
    }
  });
});

// ── Admin Demo: reset and re-verify ──

describe('Admin Demo: reset verification', () => {
  it('reset user clears twin data', async () => {
    // Reset emma-rodriguez
    await fetchJSON(`${ORCHESTRATOR}/admin/demo/reset-user/emma-rodriguez`, {
      method: 'POST',
    });

    // Twin should be empty
    const { body } = await fetchAnon(`${ORCHESTRATOR}/twin/emma-rodriguez`);
    assert.equal(body.accounts.length, 0, 'Twin should have no accounts after reset');
  });
});
