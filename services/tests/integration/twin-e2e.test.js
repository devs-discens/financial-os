/**
 * E2E tests for the Digital Financial Twin (Component 5).
 * Tests run against live Docker containers:
 *   - postgres:5433, maple-direct:3001, heritage-financial:3002,
 *     frontier-business:3003, registry:3010, orchestrator:3020
 *
 * These tests connect banks via onboarding and then verify the twin
 * endpoints return correct snapshot, metrics, transactions, and SCD2 history.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const ORCHESTRATOR = 'http://localhost:3020';
const REGISTRY = 'http://localhost:3010';

// Unique user for twin tests to avoid interference
const TWIN_USER = 'twin-test-user';
const MFA_USER = 'twin-mfa-user';

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

async function ensureLive(institutionId) {
  const { body } = await fetchJSON(`${REGISTRY}/registry/institutions/${institutionId}`);
  if (body.status === 'not_registered') {
    await fetchJSON(`${REGISTRY}/registry/institutions/${institutionId}/register`, {
      method: 'POST',
      body: JSON.stringify({
        capabilities: ['ACCOUNT_BASIC', 'ACCOUNT_DETAILED', 'TRANSACTIONS', 'BALANCES'],
      }),
    });
  }
  const { body: after } = await fetchJSON(`${REGISTRY}/registry/institutions/${institutionId}`);
  if (after.status === 'pending') {
    await fetchJSON(`${REGISTRY}/registry/institutions/${institutionId}/go-live`, {
      method: 'POST',
    });
  }
}

// ── Setup: connect all banks for twin user ──

describe('Twin: Setup — connect banks', () => {
  before(async () => {
    await ensureLive('maple-direct');
    await ensureLive('heritage-financial');
    await ensureLive('frontier-business');
  });

  it('connects Maple Direct for twin user', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'maple-direct', user_id: TWIN_USER }),
    });
    assert.equal(status, 200);
    assert.ok(
      body.status === 'connected' || body.status === 'already_connected',
      `Expected connected/already_connected, got ${body.status}`,
    );
  });

  it('connects Frontier Business for twin user', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'frontier-business', user_id: TWIN_USER }),
    });
    assert.equal(status, 200);
    assert.ok(
      body.status === 'connected' || body.status === 'already_connected',
      `Expected connected/already_connected, got ${body.status}`,
    );
  });

  it('connects Heritage Financial (MFA) for twin user', async () => {
    // Start connect — should return mfa_required
    const { body: connectBody } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'heritage-financial', user_id: MFA_USER }),
    });

    if (connectBody.status === 'already_connected') {
      return; // Already connected from a prior run
    }

    assert.equal(connectBody.status, 'mfa_required');

    // Submit MFA
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/mfa`, {
      method: 'POST',
      body: JSON.stringify({
        connection_id: connectBody.connection_id,
        mfa_code: '123456',
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'connected');
  });
});

// ── Twin Snapshot ──

describe('Twin: Snapshot', () => {
  it('returns full twin snapshot for connected user', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/twin/${TWIN_USER}`);
    assert.equal(status, 200);
    assert.equal(body.user_id, TWIN_USER);
    assert.ok(body.snapshot_at);

    // Should have connections
    assert.ok(Array.isArray(body.connections));
    assert.ok(body.connections.length >= 2, `Expected at least 2 connections, got ${body.connections.length}`);

    // Should have accounts (current rows only)
    // With multi-user banks, twin-test-user gets at least 2 guaranteed accounts
    // (maple chequing + frontier biz chequing), plus optional ones based on RNG
    assert.ok(Array.isArray(body.accounts));
    assert.ok(body.accounts.length >= 2, `Expected at least 2 accounts, got ${body.accounts.length}`);

    // Should have metrics
    assert.ok(body.metrics);
    assert.ok(typeof body.metrics.net_worth === 'number');
    assert.ok(typeof body.metrics.total_assets === 'number');
    assert.ok(typeof body.metrics.total_liabilities === 'number');

    // Counts
    assert.ok(body.account_count >= 2);
    assert.ok(body.institution_count >= 2);
    assert.ok(body.transaction_count > 0, 'Should have pulled transactions');
  });

  it('returns empty snapshot for nonexistent user', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/twin/nonexistent-user-xyz`);
    assert.equal(status, 200);
    assert.equal(body.user_id, 'nonexistent-user-xyz');
    assert.deepEqual(body.connections, []);
    assert.deepEqual(body.accounts, []);
    assert.equal(body.account_count, 0);
    assert.equal(body.institution_count, 0);
  });
});

// ── Transactions ──

describe('Twin: Transactions', () => {
  it('returns transactions from all connected banks', async () => {
    const { status, body } = await fetchJSON(
      `${ORCHESTRATOR}/twin/${TWIN_USER}/transactions`,
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.transactions));
    assert.ok(body.transactions.length > 0, 'Should have transactions');
    assert.equal(body.count, body.transactions.length);

    // Verify transaction structure
    const txn = body.transactions[0];
    assert.ok(txn.transaction_id);
    assert.ok(txn.account_id);
    assert.ok(txn.connection_id);
    assert.ok(txn.institution_id);
    assert.ok(typeof txn.amount === 'number' || typeof txn.amount === 'string');
  });

  it('filters transactions by account_id', async () => {
    const { body: allBody } = await fetchJSON(
      `${ORCHESTRATOR}/twin/${TWIN_USER}/transactions`,
    );
    if (allBody.transactions.length === 0) return;

    const accountId = allBody.transactions[0].account_id;
    const { body } = await fetchJSON(
      `${ORCHESTRATOR}/twin/${TWIN_USER}/transactions?account_id=${accountId}`,
    );
    assert.ok(body.transactions.length > 0);
    assert.ok(
      body.transactions.every(t => t.account_id === accountId),
      'All transactions should match the filter',
    );
  });

  it('returns empty list for user with no transactions', async () => {
    const { status, body } = await fetchJSON(
      `${ORCHESTRATOR}/twin/nonexistent-user-xyz/transactions`,
    );
    assert.equal(status, 200);
    assert.deepEqual(body.transactions, []);
    assert.equal(body.count, 0);
  });
});

// ── Metrics ──

describe('Twin: Metrics', () => {
  it('returns computed metrics with breakdown', async () => {
    const { status, body } = await fetchJSON(
      `${ORCHESTRATOR}/twin/${TWIN_USER}/metrics`,
    );
    assert.equal(status, 200);
    assert.equal(body.user_id, TWIN_USER);
    assert.ok(body.current);

    // Should have net_worth metric
    assert.ok(body.current.net_worth, 'Should have net_worth metric');
    assert.ok(typeof body.current.net_worth.value === 'number');
    assert.ok(body.current.net_worth.breakdown);
    assert.ok(body.current.net_worth.computed_at);

    // Should have total_assets
    assert.ok(body.current.total_assets, 'Should have total_assets metric');
    assert.ok(body.current.total_assets.value >= 0);

    // Should have total_liabilities
    assert.ok(body.current.total_liabilities, 'Should have total_liabilities metric');

    // History should have entries
    assert.ok(Array.isArray(body.history));
    assert.ok(body.history.length > 0, 'Should have metric history');
  });

  it('net_worth breakdown shows per-account detail', async () => {
    const { body } = await fetchJSON(
      `${ORCHESTRATOR}/twin/${TWIN_USER}/metrics`,
    );
    const nw = body.current.net_worth;
    assert.ok(nw.breakdown.assets || nw.breakdown.liabilities,
      'Net worth breakdown should have assets or liabilities');
  });

  it('returns empty metrics for user with no data', async () => {
    const { status, body } = await fetchJSON(
      `${ORCHESTRATOR}/twin/nonexistent-user-xyz/metrics`,
    );
    assert.equal(status, 200);
    assert.deepEqual(body.current, {});
    assert.deepEqual(body.history, []);
  });
});

// ── SCD2 Account History ──

describe('Twin: SCD2 Account History', () => {
  it('returns version history for an account', async () => {
    // Get the twin snapshot to find an account
    const { body: snapshot } = await fetchJSON(`${ORCHESTRATOR}/twin/${TWIN_USER}`);
    assert.ok(snapshot.accounts.length > 0, 'Need at least one account');

    const acct = snapshot.accounts[0];
    const { status, body } = await fetchJSON(
      `${ORCHESTRATOR}/twin/${TWIN_USER}/accounts/${acct.account_id}/history?connection_id=${acct.connection_id}`,
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.versions));
    assert.ok(body.versions.length >= 1, 'Should have at least 1 version');

    // Current version should have valid_to = null
    const current = body.versions[body.versions.length - 1];
    assert.equal(current.valid_to, null, 'Current version should have valid_to = null');
    assert.ok(current.valid_from, 'Should have valid_from timestamp');
    assert.ok(current.pull_id, 'Should have pull_id');
  });

  it('returns empty history for nonexistent account', async () => {
    const { status, body } = await fetchJSON(
      `${ORCHESTRATOR}/twin/${TWIN_USER}/accounts/nonexistent-acct/history`,
    );
    assert.equal(status, 200);
    assert.deepEqual(body.versions, []);
  });
});

// ── Heritage Financial Twin (MFA user) ──

describe('Twin: Heritage Financial data (MFA user)', () => {
  it('MFA user has Heritage accounts in twin', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/twin/${MFA_USER}`);
    assert.equal(status, 200);
    assert.ok(body.accounts.length >= 1, 'Heritage has at least mortgage');

    // Verify mortgage is classified as liability
    const mortgage = body.accounts.find(a =>
      a.account_type === 'MORTGAGE' || a.account_category === 'LOAN_ACCOUNT',
    );
    assert.ok(mortgage, 'Should have a mortgage account');
  });

  it('MFA user has metrics computed', async () => {
    const { body } = await fetchJSON(`${ORCHESTRATOR}/twin/${MFA_USER}/metrics`);
    assert.ok(body.current.net_worth, 'MFA user should have net_worth computed');
    assert.ok(body.current.total_liabilities,
      'MFA user should have liabilities (mortgage)');
  });
});
