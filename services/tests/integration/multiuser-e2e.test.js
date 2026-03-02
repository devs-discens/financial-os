/**
 * E2E tests for multi-user bank support.
 * Tests that different users get different accounts from the same banks.
 * Runs against live Docker containers:
 *   - maple-direct:3001, heritage-financial:3002, frontier-business:3003
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const MAPLE = 'http://localhost:3001';
const HERITAGE = 'http://localhost:3002';
const FRONTIER = 'http://localhost:3003';

// OAuth with user_id passed in authorize
async function oauthForUser(baseUrl, userId) {
  const authRes = await fetch(
    `${baseUrl}/oauth/authorize?client_id=financial-os&redirect_uri=http://localhost:8100/callback&scope=ACCOUNT_BASIC+ACCOUNT_DETAILED+TRANSACTIONS+STATEMENTS+BALANCES+PAYMENT_SUPPORT&state=test&auto_approve=true&user_id=${userId}`,
    { redirect: 'manual' }
  );

  // May be redirect (no MFA) or 200 (MFA required)
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
  assert.equal(mfaBody.status, 'mfa_required');
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

async function getAccounts(baseUrl, accessToken) {
  const res = await fetch(`${baseUrl}/fdx/v6/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}

// ── Multi-user: Maple Direct ──

describe('Multi-user: Maple Direct', () => {
  it('alex-chen gets original accounts with exact IDs and balances', async () => {
    const tokens = await oauthForUser(MAPLE, 'alex-chen');
    const data = await getAccounts(MAPLE, tokens.access_token);

    const ids = data.accounts.map(a => a.accountId).sort();
    assert.deepEqual(ids, ['mpl-chq-001', 'mpl-mc-001', 'mpl-visa-001']);

    const chq = data.accounts.find(a => a.accountId === 'mpl-chq-001');
    assert.equal(chq.currentBalance, 4200);

    const visa = data.accounts.find(a => a.accountId === 'mpl-visa-001');
    assert.equal(visa.currentBalance, 2800);

    const mc = data.accounts.find(a => a.accountId === 'mpl-mc-001');
    assert.equal(mc.currentBalance, 450);
  });

  it('different user gets different account IDs', async () => {
    const tokens = await oauthForUser(MAPLE, 'jane-doe');
    const data = await getAccounts(MAPLE, tokens.access_token);

    assert.ok(data.accounts.length >= 1, 'Should have at least chequing');
    // Account IDs should NOT be the alex-chen originals
    const ids = data.accounts.map(a => a.accountId);
    assert.ok(!ids.includes('mpl-chq-001'), 'jane-doe should not have alex-chen IDs');
    // Should have a prefix based on jane-doe
    assert.ok(ids[0].startsWith('mpl-jane-d'), `Expected prefix 'mpl-jane-d', got ${ids[0]}`);
  });

  it('same user gets deterministic (identical) data on repeated calls', async () => {
    const tokens1 = await oauthForUser(MAPLE, 'bob-smith');
    const data1 = await getAccounts(MAPLE, tokens1.access_token);

    const tokens2 = await oauthForUser(MAPLE, 'bob-smith');
    const data2 = await getAccounts(MAPLE, tokens2.access_token);

    // Same accounts, same balances
    assert.equal(data1.accounts.length, data2.accounts.length);
    for (let i = 0; i < data1.accounts.length; i++) {
      assert.equal(data1.accounts[i].accountId, data2.accounts[i].accountId);
      assert.equal(data1.accounts[i].currentBalance, data2.accounts[i].currentBalance);
    }
  });
});

// ── Multi-user: Heritage Financial ──

describe('Multi-user: Heritage Financial', () => {
  it('alex-chen gets original heritage accounts', async () => {
    const tokens = await oauthForUser(HERITAGE, 'alex-chen');
    const data = await getAccounts(HERITAGE, tokens.access_token);

    const ids = data.accounts.map(a => a.accountId).sort();
    assert.ok(ids.includes('htg-mtg-001'), 'Should have original mortgage');
    assert.ok(ids.includes('htg-heloc-001'), 'Should have original HELOC');
  });
});

// ── Multi-user: Frontier Business ──

describe('Multi-user: Frontier Business', () => {
  it('alex-chen gets original frontier accounts', async () => {
    const tokens = await oauthForUser(FRONTIER, 'alex-chen');
    const data = await getAccounts(FRONTIER, tokens.access_token);

    const ids = data.accounts.map(a => a.accountId).sort();
    assert.deepEqual(ids, ['frt-biz-chq-001', 'frt-biz-visa-001']);

    const chq = data.accounts.find(a => a.accountId === 'frt-biz-chq-001');
    assert.equal(chq.currentBalance, 12400);
  });
});
