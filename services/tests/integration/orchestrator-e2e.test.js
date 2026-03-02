/**
 * E2E tests for the Onboarding Orchestrator.
 * Tests run against live Docker containers:
 *   - postgres:5433, maple-direct:3001, heritage-financial:3002,
 *     frontier-business:3003, registry:3010, orchestrator:3020
 *
 * These tests are designed to be resilient to registry state — they check
 * the current state and adapt rather than assuming pristine initial conditions.
 * This means they can run after the bank E2E tests or on their own.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ORCHESTRATOR = 'http://localhost:3020';
const REGISTRY = 'http://localhost:3010';

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

// ── Health checks ──

describe('Orchestrator health', () => {
  it('returns ok', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/health`);
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'onboarding-orchestrator');
  });
});

// ── Maple Direct: full onboarding (no MFA) ──

describe('Onboarding: Maple Direct (no MFA)', () => {
  let connectResult;

  before(async () => {
    // Ensure maple-direct is live (it should be by default)
    const { body } = await fetchJSON(`${REGISTRY}/registry/institutions/maple-direct`);
    assert.equal(body.status, 'live', 'Maple Direct should be live');
  });

  it('connects to maple-direct successfully', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'maple-direct', user_id: 'alex-chen' }),
    });
    assert.equal(status, 200);
    // First connect: 'connected'. Re-run: 'already_connected'. Both are valid.
    assert.ok(
      body.status === 'connected' || body.status === 'already_connected',
      `Expected connected or already_connected, got ${body.status}`,
    );
    assert.equal(body.institution_id, 'maple-direct');
    assert.ok(body.connection_id > 0);
    assert.ok(Array.isArray(body.accounts));
    assert.ok(body.accounts.length >= 3, `Expected at least 3 accounts, got ${body.accounts.length}`);
    connectResult = body;
  });

  it('pulled accounts with correct data', async () => {
    const chequing = connectResult.accounts.find(a => a.account_id === 'mpl-chq-001');
    assert.ok(chequing, 'Should find chequing account');
    assert.equal(chequing.account_category, 'DEPOSIT_ACCOUNT');
    assert.ok(chequing.balance > 0);

    const visa = connectResult.accounts.find(a => a.account_id === 'mpl-visa-001');
    assert.ok(visa, 'Should find Visa account');
  });
});

// ── Maple Direct: second connect returns already_connected ──

describe('Onboarding: Maple Direct (reconnection handling)', () => {
  it('returns already_connected for duplicate connection', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'maple-direct', user_id: 'alex-chen' }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'already_connected');
    assert.ok(body.connection_id > 0);
    assert.ok(body.connected_at);
    assert.ok(Array.isArray(body.accounts));
  });

  it('different user can connect to same institution', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'maple-direct', user_id: 'test-user-2' }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'connected');
    assert.equal(body.template_cached, true, 'Template should be cached from first connect');
  });
});

// ── Template API ──

describe('Templates API', () => {
  it('lists cached templates', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/templates`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.templates));
    assert.ok(body.templates.length >= 1, 'Should have at least maple template');
    const maple = body.templates.find(t => t.institution_id === 'maple-direct');
    assert.ok(maple);
    assert.equal(maple.discovery_method, 'llm_assisted');
  });

  it('gets a specific template', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/templates/maple-direct`);
    assert.equal(status, 200);
    assert.equal(body.institution_id, 'maple-direct');
    assert.equal(body.institution_name, 'Maple Direct');
    assert.ok(Array.isArray(body.scopes_supported));
    assert.ok(body.scopes_supported.length > 0);
  });

  it('returns 404 for unknown template', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/templates/nonexistent`);
    assert.equal(status, 404);
  });
});

// ── Connections API ──

describe('Connections API', () => {
  it('lists connections for alex-chen', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/connections?user_id=alex-chen`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.connections));
    assert.ok(body.connections.length >= 1);
    const mapleConn = body.connections.find(c => c.institution_id === 'maple-direct');
    assert.ok(mapleConn);
    assert.equal(mapleConn.status, 'active');
  });

  it('gets connection detail with accounts', async () => {
    const { body: listBody } = await fetchJSON(`${ORCHESTRATOR}/connections?user_id=alex-chen`);
    const connId = listBody.connections[0].id;

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/connections/${connId}`);
    assert.equal(status, 200);
    assert.ok(body.connection);
    assert.ok(Array.isArray(body.accounts));
    assert.ok(body.accounts.length >= 3);
  });

  it('gets connection events', async () => {
    const { body: listBody } = await fetchJSON(`${ORCHESTRATOR}/connections?user_id=alex-chen`);
    const connId = listBody.connections[0].id;

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/connections/${connId}/events`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.events));
    assert.ok(body.events.length >= 1);
    const connected = body.events.find(e => e.event_type === 'connected');
    assert.ok(connected, 'Should have a "connected" event');
  });

  it('returns 404 for unknown connection', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/connections/99999`);
    assert.equal(status, 404);
  });
});

// ── Non-live institutions ──

describe('Onboarding: non-live institutions', () => {
  it('returns not_available for any non-live institution', async () => {
    // Check which institutions are not live
    const { body: regBody } = await fetchJSON(`${REGISTRY}/registry/institutions`);
    const nonLive = regBody.institutions.find(i => i.status !== 'live');

    if (!nonLive) {
      // All institutions are live (e.g. bank tests ran first) — skip gracefully
      return;
    }

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: nonLive.id, user_id: 'test-non-live' }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'not_available');
    assert.equal(body.institution_id, nonLive.id);
    assert.ok(body.message.includes('not yet available'));
  });
});

// ── Heritage Financial: go-live then MFA onboarding ──

describe('Onboarding: Heritage Financial (MFA flow)', () => {
  let connectResult;

  before(async () => {
    // Ensure Heritage is live — go-live if needed
    const { body } = await fetchJSON(`${REGISTRY}/registry/institutions/heritage-financial`);
    if (body.status === 'pending') {
      await fetchJSON(`${REGISTRY}/registry/institutions/heritage-financial/go-live`, {
        method: 'POST',
      });
    }
    // Verify
    const { body: check } = await fetchJSON(`${REGISTRY}/registry/institutions/heritage-financial`);
    assert.equal(check.status, 'live');
  });

  it('connect returns mfa_required', async () => {
    // Use a unique user to avoid hitting existing connections
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'heritage-financial', user_id: 'mfa-test-user' }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'mfa_required');
    assert.ok(body.connection_id > 0);
    assert.ok(body.mfa_session);
    assert.ok(body.message);
    connectResult = body;
  });

  it('submit MFA code completes onboarding', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/mfa`, {
      method: 'POST',
      body: JSON.stringify({
        connection_id: connectResult.connection_id,
        mfa_code: '123456',
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'connected');
    assert.equal(body.institution_id, 'heritage-financial');
    assert.ok(Array.isArray(body.accounts));
    assert.ok(body.accounts.length >= 2, 'Heritage has mortgage + HELOC');
  });

  it('heritage template is cached with correct metadata', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/templates/heritage-financial`);
    assert.equal(status, 200);
    assert.equal(body.mfa_required, true);
    assert.equal(body.discovery_method, 'llm_assisted');
    assert.ok(body.polling_interval_seconds > 0, 'Polling interval should be positive');
    assert.ok(Array.isArray(body.scopes_supported));
    assert.ok(body.scopes_supported.length >= 2, 'Should recommend multiple scopes');
  });

  it('reconnecting Heritage for same user returns already_connected', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'heritage-financial', user_id: 'mfa-test-user' }),
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'already_connected');
    assert.ok(body.accounts.length >= 2);
  });
});

// ── Frontier Business: full lifecycle ──

describe('Onboarding: Frontier Business (full lifecycle)', () => {
  before(async () => {
    // Ensure Frontier is live — register and go-live if needed
    const { body } = await fetchJSON(`${REGISTRY}/registry/institutions/frontier-business`);
    if (body.status === 'not_registered') {
      await fetchJSON(`${REGISTRY}/registry/institutions/frontier-business/register`, {
        method: 'POST',
        body: JSON.stringify({
          capabilities: ['ACCOUNT_BASIC', 'ACCOUNT_DETAILED', 'TRANSACTIONS', 'BALANCES'],
        }),
      });
    }
    const { body: after } = await fetchJSON(`${REGISTRY}/registry/institutions/frontier-business`);
    if (after.status === 'pending') {
      await fetchJSON(`${REGISTRY}/registry/institutions/frontier-business/go-live`, {
        method: 'POST',
      });
    }
    // Verify
    const { body: check } = await fetchJSON(`${REGISTRY}/registry/institutions/frontier-business`);
    assert.equal(check.status, 'live');
  });

  it('connects to frontier-business successfully', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'frontier-business', user_id: 'frontier-test-user' }),
    });
    assert.equal(status, 200);
    assert.ok(
      body.status === 'connected' || body.status === 'already_connected',
      `Expected connected or already_connected, got ${body.status}`
    );
    assert.ok(body.accounts.length >= 1, 'Frontier has at least biz chequing');

    const bizChq = body.accounts.find(a => a.account_category === 'DEPOSIT_ACCOUNT');
    assert.ok(bizChq, 'Should find business chequing account');
    assert.equal(bizChq.account_category, 'DEPOSIT_ACCOUNT');
  });
});

// ── Unknown institution ──

describe('Onboarding: Unknown institution', () => {
  it('returns 404 for unknown institution', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/onboarding/connect`, {
      method: 'POST',
      body: JSON.stringify({ institution_id: 'nonexistent-bank', user_id: 'alex-chen' }),
    });
    assert.equal(status, 404);
  });
});

// ── Template deletion ──

describe('Template lifecycle', () => {
  it('returns 409 when deleting template with active connections', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/templates/maple-direct`, {
      method: 'DELETE',
    });
    assert.equal(status, 409);
    assert.ok(body.detail.includes('active connections'));
  });

  it('template still exists after failed delete', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/templates/maple-direct`);
    assert.equal(status, 200);
    assert.equal(body.institution_id, 'maple-direct');
  });
});
