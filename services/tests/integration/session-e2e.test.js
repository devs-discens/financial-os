/**
 * E2E tests for Council Session persistence + pgvector similarity search.
 * Tests run against live Docker containers:
 *   - orchestrator:3020, postgres:5433
 *
 * These tests make REAL external LLM calls (for council + embeddings).
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const ORCHESTRATOR = 'http://localhost:3020';
const USER_ID = 'alex-chen';

// Council calls + embeddings can take a while
const COUNCIL_TIMEOUT = 120_000;

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

// ── Prerequisites ──

describe('Session prerequisites', () => {
  it('orchestrator is healthy', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/health`);
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });
});

// ── Ensure bank is connected ──

describe('Session setup: connect bank', () => {
  it('connects maple-direct for alex-chen', async () => {
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

// ── Session storage ──

let collaborativeSessionId;
let adversarialSessionId;

describe('Session storage: collaborative', () => {
  it('collaborative session returns session_id in response', { timeout: COUNCIL_TIMEOUT }, async () => {
    const question = 'What are my biggest financial risks right now?';

    console.log(`\n  ── Collaborative (session test): "${question}" ──`);
    const start = Date.now();

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/collaborative`, {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_ID, question }),
    });

    console.log(`  Completed in ${Date.now() - start}ms`);

    assert.equal(status, 200);
    assert.equal(body.mode, 'collaborative');
    assert.ok(body.session_id, 'Response should include session_id');
    assert.ok(typeof body.session_id === 'number', 'session_id should be a number');

    collaborativeSessionId = body.session_id;
    console.log(`  Session ID: ${collaborativeSessionId}`);
  });
});

describe('Session storage: adversarial', () => {
  it('adversarial session returns session_id in response', { timeout: COUNCIL_TIMEOUT }, async () => {
    const question = 'Should I pay off my credit card debt or invest?';

    console.log(`\n  ── Adversarial (session test): "${question}" ──`);
    const start = Date.now();

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/adversarial`, {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_ID, question }),
    });

    console.log(`  Completed in ${Date.now() - start}ms`);

    assert.equal(status, 200);
    assert.equal(body.mode, 'adversarial');
    assert.ok(body.session_id, 'Response should include session_id');
    assert.ok(typeof body.session_id === 'number', 'session_id should be a number');

    adversarialSessionId = body.session_id;
    console.log(`  Session ID: ${adversarialSessionId}`);
  });
});

// ── Session retrieval ──

describe('Session retrieval', () => {
  it('GET /council/sessions/{id} returns full collaborative session', { timeout: 10_000 }, async () => {
    assert.ok(collaborativeSessionId, 'Need session ID from collaborative test');

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/sessions/${collaborativeSessionId}`);

    assert.equal(status, 200);
    assert.equal(body.session_id, collaborativeSessionId);
    assert.equal(body.user_id, USER_ID);
    assert.equal(body.mode, 'collaborative');
    assert.ok(body.question, 'Should have question');
    assert.ok(body.response, 'Should have full response');
    assert.ok(body.response.synthesis, 'Response should include synthesis');
    assert.ok(body.synthesis, 'Should have synthesis at top level');
    assert.ok(body.created_at, 'Should have timestamp');

    console.log(`  Retrieved session ${body.session_id}: ${body.question.substring(0, 50)}...`);
  });

  it('GET /council/sessions/{id} returns full adversarial session', { timeout: 10_000 }, async () => {
    assert.ok(adversarialSessionId, 'Need session ID from adversarial test');

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/sessions/${adversarialSessionId}`);

    assert.equal(status, 200);
    assert.equal(body.session_id, adversarialSessionId);
    assert.equal(body.mode, 'adversarial');
    assert.ok(body.response.chairman_verdict, 'Response should include chairman_verdict');

    console.log(`  Retrieved adversarial session ${body.session_id}`);
  });

  it('GET /council/sessions/{id} returns 404 for nonexistent', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/council/sessions/999999`);
    assert.equal(status, 404);
  });
});

// ── Session list ──

describe('Session list', () => {
  it('GET /council/sessions returns stored sessions ordered by date', { timeout: 10_000 }, async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/sessions?user_id=${USER_ID}`);

    assert.equal(status, 200);
    assert.ok(Array.isArray(body.sessions), 'Should have sessions array');
    assert.ok(body.sessions.length >= 2, `Should have at least 2 sessions, got ${body.sessions.length}`);
    assert.equal(body.count, body.sessions.length);

    // Should be ordered by date (most recent first)
    for (let i = 1; i < body.sessions.length; i++) {
      const prev = new Date(body.sessions[i - 1].created_at).getTime();
      const curr = new Date(body.sessions[i].created_at).getTime();
      assert.ok(prev >= curr, 'Sessions should be ordered by date descending');
    }

    // Sessions should have summary fields but NOT full response
    const first = body.sessions[0];
    assert.ok(first.session_id, 'Should have session_id');
    assert.ok(first.mode, 'Should have mode');
    assert.ok(first.question, 'Should have question');
    assert.ok(first.created_at, 'Should have created_at');

    console.log(`  Listed ${body.count} sessions for ${USER_ID}`);
  });
});

// ── Similarity search ──

describe('Similarity search', () => {
  it('check-similar with same question returns high similarity match', { timeout: 30_000 }, async () => {
    const question = 'What are my biggest financial risks right now?';

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/check-similar`, {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_ID, question }),
    });

    assert.equal(status, 200);
    assert.ok(body.count > 0, `Expected at least 1 match for same question, got ${body.count}`);
    assert.ok(Array.isArray(body.matches), 'Should have matches array');

    const topMatch = body.matches[0];
    assert.ok(topMatch.similarity >= 0.85, `Top match similarity should be >= 0.85, got ${topMatch.similarity}`);
    assert.ok(topMatch.session_id, 'Match should have session_id');
    assert.ok(topMatch.question, 'Match should have question');

    console.log(`  Same question: top match similarity=${topMatch.similarity}`);
  });

  it('check-similar with semantically similar question returns match', { timeout: 30_000 }, async () => {
    // Similar meaning to "What are my biggest financial risks right now?"
    const question = 'What financial risks should I be most worried about?';

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/check-similar`, {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_ID, question, threshold: 0.75 }),
    });

    assert.equal(status, 200);
    assert.ok(body.count > 0, `Expected match for semantically similar question, got ${body.count}`);

    const topMatch = body.matches[0];
    assert.ok(topMatch.similarity > 0.5, `Similarity should be meaningful, got ${topMatch.similarity}`);

    console.log(`  Similar question: top match similarity=${topMatch.similarity}`);
  });

  it('check-similar with unrelated question returns no matches', { timeout: 30_000 }, async () => {
    const question = 'What is the best recipe for chocolate cake?';

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/check-similar`, {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_ID, question }),
    });

    assert.equal(status, 200);
    assert.equal(body.count, 0, `Expected no matches for unrelated question, got ${body.count}`);

    console.log(`  Unrelated question: ${body.count} matches (expected 0)`);
  });
});

// ── Archive session ──

let archiveTargetId;

describe('Session archive', () => {
  it('archives a session via DELETE', { timeout: 10_000 }, async () => {
    // Use the collaborative session created earlier
    assert.ok(collaborativeSessionId, 'Need session ID from collaborative test');
    archiveTargetId = collaborativeSessionId;

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/sessions/${archiveTargetId}`, {
      method: 'DELETE',
    });

    assert.equal(status, 200);
    assert.equal(body.status, 'archived');
    assert.equal(body.session_id, archiveTargetId);

    console.log(`  Archived session ${archiveTargetId}`);
  });

  it('archived session excluded from list_sessions', { timeout: 10_000 }, async () => {
    assert.ok(archiveTargetId, 'Need archive target session ID');

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/sessions?user_id=${USER_ID}`);

    assert.equal(status, 200);
    const found = body.sessions.find(s => s.session_id === archiveTargetId);
    assert.ok(!found, `Archived session ${archiveTargetId} should not appear in list`);

    console.log(`  Session list: ${body.count} sessions, archived session ${archiveTargetId} excluded`);
  });

  it('archived session excluded from check-similar', { timeout: 30_000 }, async () => {
    assert.ok(archiveTargetId, 'Need archive target session ID');

    const question = 'What are my biggest financial risks right now?';

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/check-similar`, {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_ID, question }),
    });

    assert.equal(status, 200);
    const found = body.matches.find(m => m.session_id === archiveTargetId);
    assert.ok(!found, `Archived session ${archiveTargetId} should not appear in similarity results`);

    console.log(`  Similar check: ${body.count} matches, archived session excluded`);
  });

  it('returns 404 for already-archived session', { timeout: 10_000 }, async () => {
    assert.ok(archiveTargetId, 'Need archive target session ID');

    const { status } = await fetchJSON(`${ORCHESTRATOR}/council/sessions/${archiveTargetId}`, {
      method: 'DELETE',
    });

    assert.equal(status, 404, 'Should get 404 for already-archived session');
  });
});

// ── Link session to goal ──

describe('Session link to goal', () => {
  it('PATCH /council/sessions/{id} links a session to a goal', { timeout: 10_000 }, async () => {
    assert.ok(adversarialSessionId, 'Need session ID from adversarial test');

    // Use goal_id 1 as a test target (may or may not exist — we just verify the endpoint works)
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/sessions/${adversarialSessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ goal_id: 1 }),
    });

    assert.equal(status, 200);
    assert.equal(body.status, 'linked');
    assert.equal(body.session_id, adversarialSessionId);
    assert.equal(body.goal_id, 1);

    console.log(`  Linked session ${adversarialSessionId} to goal 1`);
  });

  it('PATCH returns 404 for nonexistent session', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/council/sessions/999999`, {
      method: 'PATCH',
      body: JSON.stringify({ goal_id: 1 }),
    });

    assert.equal(status, 404);
  });
});
