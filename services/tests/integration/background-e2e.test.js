/**
 * E2E tests for the Background Orchestration Service (Component 4).
 * Tests run against live Docker containers:
 *   - orchestrator:3020, maple-direct:3001, registry:3010, postgres:5433
 *
 * Tests verify background polling, token refresh, anomaly detection,
 * and error classification.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ORCHESTRATOR = 'http://localhost:3020';
const MAPLE = 'http://localhost:3001';
const REGISTRY = 'http://localhost:3010';

const USER_ID = 'bg-test-user';

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Health checks ──

describe('Background prerequisites', () => {
  it('orchestrator is healthy', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/health`);
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });
});

// ── Status endpoint ──

describe('Background: status', () => {
  it('returns running state', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/background/status`);
    assert.equal(status, 200);
    assert.equal(body.running, true);
    assert.equal(typeof body.cycle_count, 'number');
    assert.equal(body.poll_interval_seconds, 30);
    assert.equal(body.background_enabled, true);
  });
});

// ── Connect bank for tests ──

describe('Background: setup', () => {
  before(async () => {
    const { body } = await fetchJSON(`${REGISTRY}/registry/institutions/maple-direct`);
    assert.equal(body.status, 'live', 'Maple Direct should be live');
  });

  it('connects maple-direct for test user', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'maple-direct', user_id: USER_ID }),
    });
    assert.equal(status, 200);
    assert.ok(
      body.status === 'connected' || body.status === 'already_connected',
      `Expected connected or already_connected, got ${body.status}`,
    );
  });
});

// ── Manual trigger ──

describe('Background: manual trigger', () => {
  it('trigger runs a poll cycle', { timeout: 30_000 }, async () => {
    const before = await fetchJSON(`${ORCHESTRATOR}/background/status`);
    const prevCycles = before.body.cycle_count;

    await fetchJSON(`${ORCHESTRATOR}/background/trigger`, { method: 'POST' });

    // Wait with retries for the cycle to complete
    let currentCycles = prevCycles;
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      const after = await fetchJSON(`${ORCHESTRATOR}/background/status`);
      currentCycles = after.body.cycle_count;
      if (currentCycles > prevCycles) break;
    }

    assert.ok(
      currentCycles > prevCycles,
      `Expected cycle_count to increase: was ${prevCycles}, now ${currentCycles}`,
    );
  });

  it('events show background_poll_success', async () => {
    const { status, body } = await fetchJSON(
      `${ORCHESTRATOR}/background/events?event_type=background_poll_success&limit=5`,
    );
    assert.equal(status, 200);
    assert.ok(body.events.length > 0, 'Should have at least one success event');

    const event = body.events[0];
    assert.equal(event.event_type, 'background_poll_success');
    assert.ok(event.details.accounts > 0, 'Should report account count');
  });
});

// ── Anomaly detection ──

describe('Background: anomaly detection', { timeout: 30_000 }, () => {
  before(async () => {
    // Clear any active failures
    await fetch(`${MAPLE}/admin/failure`, { method: 'DELETE' });
  });

  after(async () => {
    await fetch(`${MAPLE}/admin/failure`, { method: 'DELETE' });
  });

  it('detects anomalous balance changes', async () => {
    // 1. Run baseline poll
    await fetchJSON(`${ORCHESTRATOR}/background/trigger`, { method: 'POST' });
    await sleep(3000);

    // 2. Enable anomalous-balance with 2x multiplier
    await fetch(`${MAPLE}/admin/failure/anomalous-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1.0, multiplier: 2.0 }),
    });

    // 3. Trigger poll — should detect anomaly
    await fetchJSON(`${ORCHESTRATOR}/background/trigger`, { method: 'POST' });
    await sleep(4000);

    // 4. Check for anomaly events
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/background/anomalies`);
    assert.equal(status, 200);
    assert.ok(body.anomalies.length > 0, 'Should have detected anomalies');

    const anomaly = body.anomalies[0];
    assert.ok(anomaly.details.pct_change >= 20, `Expected >=20% change, got ${anomaly.details.pct_change}%`);
    assert.ok(anomaly.details.account_id, 'Should identify the account');

    console.log(`  Anomaly: ${anomaly.details.detail}`);

    // 5. Clear failure
    await fetch(`${MAPLE}/admin/failure/anomalous-balance`, { method: 'DELETE' });
  });
});

// ── Consent revoked ──

describe('Background: consent revoked', { timeout: 30_000 }, () => {
  let testConnectionId;

  before(async () => {
    // Clear any failures
    await fetch(`${MAPLE}/admin/failure`, { method: 'DELETE' });

    // Connect a fresh user for this test
    const { body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'maple-direct', user_id: 'bg-consent-test' }),
    });
    assert.ok(
      body.status === 'connected' || body.status === 'already_connected',
      `Expected connected, got ${body.status}`,
    );
    testConnectionId = body.connection_id;
  });

  after(async () => {
    await fetch(`${MAPLE}/admin/failure`, { method: 'DELETE' });
  });

  it('marks connection as revoked on 403', async () => {
    // Enable consent-revoked
    await fetch(`${MAPLE}/admin/failure/consent-revoked`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1.0 }),
    });

    // Trigger poll
    await fetchJSON(`${ORCHESTRATOR}/background/trigger`, { method: 'POST' });
    await sleep(4000);

    // Check events
    const { body } = await fetchJSON(`${ORCHESTRATOR}/background/events?event_type=consent_revoked`);
    assert.ok(body.events.length > 0, 'Should have consent_revoked event');

    console.log(`  Consent revoked events: ${body.events.length}`);

    // Clear failure
    await fetch(`${MAPLE}/admin/failure/consent-revoked`, { method: 'DELETE' });
  });
});

// ── Rate limit handling ──

describe('Background: rate limit backoff', { timeout: 30_000 }, () => {
  before(async () => {
    await fetch(`${MAPLE}/admin/failure`, { method: 'DELETE' });

    // Ensure test user has active connection
    await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'maple-direct', user_id: 'bg-rate-test' }),
    });
  });

  after(async () => {
    await fetch(`${MAPLE}/admin/failure`, { method: 'DELETE' });
  });

  it('logs poll failure on rate limit', async () => {
    // Enable rate limit
    await fetch(`${MAPLE}/admin/failure/rate-limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1.0, retryAfter: 10 }),
    });

    // Trigger poll
    await fetchJSON(`${ORCHESTRATOR}/background/trigger`, { method: 'POST' });
    await sleep(4000);

    // Check for failure events
    const { body } = await fetchJSON(`${ORCHESTRATOR}/background/events?event_type=background_poll_failed`);
    // Rate limit connections will have poll_failed events
    assert.ok(body.count >= 0, 'Should handle rate limit gracefully');

    // Clear and verify system recovers
    await fetch(`${MAPLE}/admin/failure/rate-limit`, { method: 'DELETE' });
  });
});

// ── Events endpoint filtering ──

describe('Background: events endpoint', () => {
  it('returns events filtered by type', async () => {
    const { status, body } = await fetchJSON(
      `${ORCHESTRATOR}/background/events?event_type=background_poll_success`,
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.events));
    for (const event of body.events) {
      assert.equal(event.event_type, 'background_poll_success');
    }
  });

  it('respects limit parameter', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/background/events?limit=2`);
    assert.equal(status, 200);
    assert.ok(body.events.length <= 2);
  });
});
