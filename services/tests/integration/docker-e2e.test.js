/**
 * End-to-end tests against live Docker containers.
 * Expects services running at:
 *   - Maple Direct:       http://localhost:3001
 *   - Heritage Financial: http://localhost:3002
 *   - Frontier Business:  http://localhost:3003
 *   - Registry:           http://localhost:3010
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const MAPLE = 'http://localhost:3001';
const HERITAGE = 'http://localhost:3002';
const FRONTIER = 'http://localhost:3003';
const REGISTRY = 'http://localhost:3010';

// ── Helpers ──

async function oauthAutoApprove(baseUrl) {
  const authRes = await fetch(
    `${baseUrl}/oauth/authorize?client_id=financial-os&redirect_uri=http://localhost:8100/callback&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED+TRANSACTIONS+STATEMENTS+BALANCES+PAYMENT_SUPPORT&state=test&auto_approve=true`,
    { redirect: 'manual' }
  );
  assert.equal(authRes.status, 302, `Expected redirect, got ${authRes.status}`);
  const location = new URL(authRes.headers.get('location'));
  const code = location.searchParams.get('code');
  assert.ok(code, 'No auth code in redirect');

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
  const tokens = await tokenRes.json();
  assert.ok(tokens.access_token, 'No access_token');
  return tokens;
}

async function oauthWithMfa(baseUrl) {
  const authRes = await fetch(
    `${baseUrl}/oauth/authorize?client_id=financial-os&redirect_uri=http://localhost:8100/callback&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED+TRANSACTIONS+STATEMENTS+BALANCES+PAYMENT_SUPPORT&state=test&auto_approve=true`
  );
  const mfaBody = await authRes.json();
  assert.equal(mfaBody.status, 'mfa_required');

  const mfaRes = await fetch(`${baseUrl}/oauth/authorize/mfa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfa_session: mfaBody.mfa_session, mfa_code: '123456' }),
  });
  const { code } = await mfaRes.json();
  assert.ok(code, 'No auth code after MFA');

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
  const tokens = await tokenRes.json();
  assert.ok(tokens.access_token, 'No access_token after MFA');
  return tokens;
}

async function getJson(url, token) {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

// ── Tests ──

describe('Docker E2E: Health Checks', () => {
  it('Maple Direct is alive', async () => {
    const { status, body } = await getJson(`${MAPLE}/health`);
    assert.equal(status, 200);
    assert.equal(body.institution, 'maple-direct');
  });

  it('Heritage Financial is alive', async () => {
    const { status, body } = await getJson(`${HERITAGE}/health`);
    assert.equal(status, 200);
    assert.equal(body.institution, 'heritage-financial');
  });

  it('Frontier Business is alive', async () => {
    const { status, body } = await getJson(`${FRONTIER}/health`);
    assert.equal(status, 200);
    assert.equal(body.institution, 'frontier-business');
  });

  it('Registry is alive', async () => {
    const { status, body } = await getJson(`${REGISTRY}/health`);
    assert.equal(status, 200);
    assert.equal(body.service, 'open-banking-registry');
  });
});

describe('Docker E2E: FDX Discovery', () => {
  for (const [name, url] of [['Maple', MAPLE], ['Heritage', HERITAGE], ['Frontier', FRONTIER]]) {
    it(`${name} exposes .well-known/fdx-configuration`, async () => {
      const { status, body } = await getJson(`${url}/.well-known/fdx-configuration`);
      assert.equal(status, 200);
      assert.equal(body.fdx_version, '6.0');
      assert.ok(body.authorization_endpoint);
      assert.ok(body.token_endpoint);
      assert.ok(body.accounts_endpoint);
      assert.ok(body.scopes_supported.length > 0);
    });
  }
});

describe('Docker E2E: Registry', () => {
  it('lists 3 institutions with correct statuses', async () => {
    const { body } = await getJson(`${REGISTRY}/registry/institutions`);
    assert.equal(body.total, 3);
    const byId = Object.fromEntries(body.institutions.map(i => [i.id, i]));
    assert.equal(byId['maple-direct'].status, 'live');
    assert.equal(byId['heritage-financial'].status, 'pending');
    assert.equal(byId['frontier-business'].status, 'not_registered');
  });

  it('gets single institution', async () => {
    const { body } = await getJson(`${REGISTRY}/registry/institutions/maple-direct`);
    assert.equal(body.name, 'Maple Direct');
  });

  it('registers frontier (not_registered → pending)', async () => {
    const res = await fetch(`${REGISTRY}/registry/institutions/frontier-business/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(body.institution.status, 'pending');
  });

  it('goes live heritage (pending → live)', async () => {
    const res = await fetch(`${REGISTRY}/registry/institutions/heritage-financial/go-live`, {
      method: 'POST',
    });
    const body = await res.json();
    assert.equal(body.institution.status, 'live');
  });

  it('SSE events stream connects', async () => {
    const controller = new AbortController();
    const res = await fetch(`${REGISTRY}/registry/events`, { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');

    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('"type":"connected"'));
    controller.abort();
  });
});

describe('Docker E2E: Maple Direct — Full OAuth + FDX', () => {
  let token;

  before(async () => {
    const tokens = await oauthAutoApprove(MAPLE);
    token = tokens.access_token;
  });

  it('lists 3 accounts (chequing, Visa, Mastercard)', async () => {
    const { status, body } = await getJson(`${MAPLE}/fdx/v6/accounts`, token);
    assert.equal(status, 200);
    assert.equal(body.accounts.length, 3);
    const ids = body.accounts.map(a => a.accountId).sort();
    assert.deepEqual(ids, ['mpl-chq-001', 'mpl-mc-001', 'mpl-visa-001']);
  });

  it('chequing has $4,200 balance in CAD', async () => {
    const { body } = await getJson(`${MAPLE}/fdx/v6/accounts/mpl-chq-001`, token);
    assert.equal(body.currentBalance, 4200);
    assert.equal(body.currency, 'CAD');
    assert.equal(body.accountType, 'CHECKING');
  });

  it('Visa has $2,800 balance and $10k limit', async () => {
    const { body } = await getJson(`${MAPLE}/fdx/v6/accounts/mpl-visa-001`, token);
    assert.equal(body.currentBalance, 2800);
    assert.equal(body.creditLimit, 10000);
  });

  it('transactions have both CREDIT (income) and DEBIT (expenses)', async () => {
    const { body } = await getJson(`${MAPLE}/fdx/v6/accounts/mpl-chq-001/transactions`, token);
    assert.ok(body.transactions.length > 0);
    const types = new Set(body.transactions.map(t => t.transactionType));
    assert.ok(types.has('CREDIT'));
    assert.ok(types.has('DEBIT'));
  });

  it('transactions paginate correctly', async () => {
    const p1 = await getJson(`${MAPLE}/fdx/v6/accounts/mpl-chq-001/transactions?limit=10`, token);
    assert.equal(p1.body.transactions.length, 10);
    assert.ok(p1.body.page.nextOffset);
    assert.ok(p1.body.page.totalElements > 10);

    const p2 = await getJson(`${MAPLE}/fdx/v6/accounts/mpl-chq-001/transactions?limit=10&offset=${p1.body.page.nextOffset}`, token);
    assert.equal(p2.body.transactions.length, 10);

    const ids1 = new Set(p1.body.transactions.map(t => t.transactionId));
    for (const tx of p2.body.transactions) {
      assert.ok(!ids1.has(tx.transactionId), 'Pages overlap');
    }
  });

  it('date filtering returns only transactions in range', async () => {
    const { body } = await getJson(
      `${MAPLE}/fdx/v6/accounts/mpl-chq-001/transactions?startTime=2025-12-01&endTime=2026-01-01`, token
    );
    for (const tx of body.transactions) {
      const d = new Date(tx.transactionTimestamp);
      assert.ok(d >= new Date('2025-12-01'));
      assert.ok(d <= new Date('2026-01-01'));
    }
  });

  it('payment networks returns EFT and INTERAC', async () => {
    const { body } = await getJson(`${MAPLE}/fdx/v6/accounts/mpl-chq-001/payment-networks`, token);
    const types = body.paymentNetworks.map(n => n.type);
    assert.ok(types.includes('EFT'));
    assert.ok(types.includes('INTERAC'));
  });

  it('token refresh works and invalidates old token', async () => {
    const tokens = await oauthAutoApprove(MAPLE);

    const refreshRes = await fetch(`${MAPLE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    const newTokens = await refreshRes.json();
    assert.ok(newTokens.access_token);
    assert.notEqual(newTokens.access_token, tokens.access_token);

    // Old token should fail
    const { status: oldStatus } = await getJson(`${MAPLE}/fdx/v6/accounts`, tokens.access_token);
    assert.equal(oldStatus, 401);

    // New token should work
    const { status: newStatus } = await getJson(`${MAPLE}/fdx/v6/accounts`, newTokens.access_token);
    assert.equal(newStatus, 200);
  });

  it('token revocation works', async () => {
    const tokens = await oauthAutoApprove(MAPLE);
    await fetch(`${MAPLE}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokens.access_token }),
    });
    const { status } = await getJson(`${MAPLE}/fdx/v6/accounts`, tokens.access_token);
    assert.equal(status, 401);
  });
});

describe('Docker E2E: Heritage Financial — MFA + Mortgage', () => {
  let token;

  before(async () => {
    const tokens = await oauthWithMfa(HERITAGE);
    token = tokens.access_token;
  });

  it('requires MFA during OAuth', async () => {
    const res = await fetch(
      `${HERITAGE}/oauth/authorize?client_id=financial-os&redirect_uri=http://localhost:8100/callback&scope=ACCOUNT_BASIC&state=test&auto_approve=true`
    );
    const body = await res.json();
    assert.equal(body.status, 'mfa_required');
  });

  it('has 2 accounts (mortgage + HELOC)', async () => {
    const { body } = await getJson(`${HERITAGE}/fdx/v6/accounts`, token);
    assert.equal(body.accounts.length, 2);
    const ids = body.accounts.map(a => a.accountId).sort();
    assert.deepEqual(ids, ['htg-heloc-001', 'htg-mtg-001']);
  });

  it('mortgage has $385k principal at 4.89%', async () => {
    const { body } = await getJson(`${HERITAGE}/fdx/v6/accounts/htg-mtg-001`, token);
    assert.equal(body.principalBalance, 385000);
    assert.equal(body.interestRate, 4.89);
    assert.equal(body.compounding, 'SEMI_ANNUAL');
  });

  it('HELOC has $0 balance and $15k limit', async () => {
    const { body } = await getJson(`${HERITAGE}/fdx/v6/accounts/htg-heloc-001`, token);
    assert.equal(body.currentBalance, 0);
    assert.equal(body.creditLimit, 15000);
  });

  it('mortgage statements have amortization data', async () => {
    const { body } = await getJson(`${HERITAGE}/fdx/v6/accounts/htg-mtg-001/statements`, token);
    assert.ok(body.statements.length > 0);
    const stmt = body.statements[0];
    assert.ok(stmt.principalPayment > 0);
    assert.ok(stmt.interestPayment > 0);
    assert.ok(stmt.remainingBalance > 0);
    assert.equal(stmt.monthlyPayment, 2547.32);
  });

  it('mortgage has no transactions (balance changes only)', async () => {
    const { body } = await getJson(`${HERITAGE}/fdx/v6/accounts/htg-mtg-001/transactions`, token);
    assert.equal(body.transactions.length, 0);
  });

  it('responses are slow (>400ms)', async () => {
    const start = Date.now();
    await getJson(`${HERITAGE}/fdx/v6/accounts`, token);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 400, `Too fast: ${elapsed}ms`);
  });
});

describe('Docker E2E: Frontier Business — Irregular Income', () => {
  let token;

  before(async () => {
    const tokens = await oauthAutoApprove(FRONTIER);
    token = tokens.access_token;
  });

  it('has 2 business accounts', async () => {
    const { body } = await getJson(`${FRONTIER}/fdx/v6/accounts`, token);
    assert.equal(body.accounts.length, 2);
  });

  it('business chequing belongs to Chen Consulting Inc.', async () => {
    const { body } = await getJson(`${FRONTIER}/fdx/v6/accounts/frt-biz-chq-001`, token);
    assert.equal(body.businessName, 'Chen Consulting Inc.');
    assert.equal(body.currentBalance, 12400);
  });

  it('has irregular consulting income ($1.5k-$6k)', async () => {
    const { body } = await getJson(`${FRONTIER}/fdx/v6/accounts/frt-biz-chq-001/transactions`, token);
    const incomes = body.transactions.filter(t => t.transactionType === 'CREDIT');
    assert.ok(incomes.length >= 12, `Too few incomes: ${incomes.length}`);
    for (const tx of incomes) {
      assert.ok(tx.amount >= 1500 && tx.amount <= 6000, `Out of range: ${tx.amount}`);
    }
    // Verify amounts vary
    const amounts = new Set(incomes.map(t => t.amount));
    assert.ok(amounts.size > 1, 'Income should vary');
  });

  it('business Visa has SaaS charges', async () => {
    const { body } = await getJson(`${FRONTIER}/fdx/v6/accounts/frt-biz-visa-001/transactions`, token);
    const descriptions = body.transactions.map(t => t.description || '');
    const hasSaaS = descriptions.some(d => d.includes('Slack') || d.includes('Figma') || d.includes('Adobe'));
    assert.ok(hasSaaS, 'Missing SaaS charges');
  });
});

describe('Docker E2E: Failure Injection', () => {
  it('rate-limit returns 429 then clears', async () => {
    const tokens = await oauthAutoApprove(MAPLE);

    await fetch(`${MAPLE}/admin/failure/rate-limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1.0 }),
    });

    const { status } = await getJson(`${MAPLE}/fdx/v6/accounts`, tokens.access_token);
    assert.equal(status, 429);

    await fetch(`${MAPLE}/admin/failure/rate-limit`, { method: 'DELETE' });

    const { status: status2 } = await getJson(`${MAPLE}/fdx/v6/accounts`, tokens.access_token);
    assert.equal(status2, 200);
  });

  it('outage returns 503', async () => {
    const tokens = await oauthAutoApprove(FRONTIER);

    await fetch(`${FRONTIER}/admin/failure/outage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1.0 }),
    });

    const { status } = await getJson(`${FRONTIER}/fdx/v6/accounts`, tokens.access_token);
    assert.equal(status, 503);

    await fetch(`${FRONTIER}/admin/failure`, { method: 'DELETE' });
  });

  it('token-expiry returns 401', async () => {
    const tokens = await oauthAutoApprove(MAPLE);

    await fetch(`${MAPLE}/admin/failure/token-expiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1.0 }),
    });

    const { status } = await getJson(`${MAPLE}/fdx/v6/accounts`, tokens.access_token);
    assert.equal(status, 401);

    await fetch(`${MAPLE}/admin/failure`, { method: 'DELETE' });
  });
});

describe('Docker E2E: Error Handling', () => {
  it('401 for missing auth header', async () => {
    const { status } = await getJson(`${MAPLE}/fdx/v6/accounts`);
    assert.equal(status, 401);
  });

  it('401 for invalid token', async () => {
    const { status } = await getJson(`${MAPLE}/fdx/v6/accounts`, 'bogus-token');
    assert.equal(status, 401);
  });

  it('404 with FDX code 701 for unknown account', async () => {
    const tokens = await oauthAutoApprove(MAPLE);
    const { status, body } = await getJson(`${MAPLE}/fdx/v6/accounts/nonexistent`, tokens.access_token);
    assert.equal(status, 404);
    assert.equal(body.code, 701);
  });
});
