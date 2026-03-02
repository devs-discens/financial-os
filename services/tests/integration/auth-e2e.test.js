/**
 * E2E tests for authentication system.
 * Tests run against live Docker containers:
 *   - orchestrator:3020
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ORCHESTRATOR = 'http://localhost:3020';

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

// ── Auth: Login ──

describe('Auth: Login', () => {
  it('logs in as alex-chen with valid credentials', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'alex-chen', password: 'password123' }),
    });
    assert.equal(status, 200);
    assert.ok(body.access_token, 'Expected access_token');
    assert.ok(body.refresh_token, 'Expected refresh_token');
    assert.equal(body.user.id, 'alex-chen');
    assert.equal(body.user.display_name, 'Alex Chen');
    assert.equal(body.user.role, 'user');
    assert.ok(!body.user.password_hash, 'password_hash should not be returned');
  });

  it('logs in as admin with valid credentials', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    assert.equal(status, 200);
    assert.equal(body.user.id, 'admin');
    assert.equal(body.user.role, 'admin');
  });

  it('rejects invalid password', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'alex-chen', password: 'wrong' }),
    });
    assert.equal(status, 401);
  });

  it('rejects non-existent user', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'nobody', password: 'test' }),
    });
    assert.equal(status, 401);
  });
});

// ── Auth: Register ──

describe('Auth: Register', () => {
  const testUser = `test-user-${Date.now()}`;

  it('registers a new user', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/auth/register`, {
      method: 'POST',
      body: JSON.stringify({
        username: testUser,
        display_name: 'Test User',
        password: 'testpass123',
      }),
    });
    assert.equal(status, 200);
    assert.ok(body.access_token, 'Expected access_token');
    assert.ok(body.refresh_token, 'Expected refresh_token');
    assert.equal(body.user.id, testUser);
    assert.equal(body.user.display_name, 'Test User');
    assert.equal(body.user.role, 'user');
  });

  it('rejects duplicate username', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/auth/register`, {
      method: 'POST',
      body: JSON.stringify({
        username: testUser,
        display_name: 'Duplicate',
        password: 'testpass123',
      }),
    });
    assert.equal(status, 409);
  });
});

// ── Auth: /me ──

describe('Auth: /me endpoint', () => {
  it('returns user info with valid token', async () => {
    const login = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'alex-chen', password: 'password123' }),
    });
    const token = login.body.access_token;

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.equal(body.user.id, 'alex-chen');
    assert.equal(body.user.display_name, 'Alex Chen');
  });

  it('rejects request without token', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/auth/me`);
    assert.equal(status, 401);
  });

  it('rejects request with invalid token', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/auth/me`, {
      headers: { Authorization: 'Bearer invalid-token-here' },
    });
    assert.equal(status, 401);
  });
});

// ── Auth: Refresh ──

describe('Auth: Token refresh', () => {
  it('refreshes an access token', async () => {
    const login = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'alex-chen', password: 'password123' }),
    });
    const refreshToken = login.body.refresh_token;

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/auth/refresh`, {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    assert.equal(status, 200);
    assert.ok(body.access_token, 'Expected new access_token');

    // New token should work for /me
    const me = await fetchJSON(`${ORCHESTRATOR}/auth/me`, {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, 'alex-chen');
  });

  it('rejects invalid refresh token', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/auth/refresh`, {
      method: 'POST',
      body: JSON.stringify({ refresh_token: 'invalid' }),
    });
    assert.equal(status, 401);
  });
});

// ── Auth: Admin access ──

describe('Auth: Admin routes', () => {
  it('admin can list users', async () => {
    const login = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const token = login.body.access_token;

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.users));
    assert.ok(body.users.length >= 2, 'Should have at least alex-chen and admin');
  });

  it('non-admin gets 403 on admin routes', async () => {
    const login = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'alex-chen', password: 'password123' }),
    });
    const token = login.body.access_token;

    const { status } = await fetchJSON(`${ORCHESTRATOR}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 403);
  });
});

// ── Auth: Backward compatibility ──

describe('Auth: Backward compatibility', () => {
  it('existing routes work without auth (fallback to default user_id)', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/connections?user_id=alex-chen`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.connections));
  });

  it('authenticated requests use auth user_id', async () => {
    const login = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'alex-chen', password: 'password123' }),
    });
    const token = login.body.access_token;

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/connections`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.connections));
  });
});
