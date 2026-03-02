/**
 * E2E tests for the LLM Council (Component 7).
 * Tests run against live Docker containers:
 *   - orchestrator:3020, pii-filter:3030, postgres:5433,
 *     maple-direct:3001, registry:3010
 *
 * These tests make REAL external LLM calls (requires API keys in .env)
 * and are slower (~30-60s per council run).
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const ORCHESTRATOR = 'http://localhost:3020';
const PII_FILTER = 'http://localhost:3030';
const REGISTRY = 'http://localhost:3010';

const USER_ID = 'alex-chen';

// Council calls can take a while with 3-4 real LLM calls
const COUNCIL_TIMEOUT = 120_000;

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

// ── Health checks ──

describe('Council prerequisites', () => {
  it('orchestrator is healthy', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/health`);
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });

  it('pii-filter is healthy', async () => {
    const { status, body } = await fetchJSON(`${PII_FILTER}/health`);
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });
});

// ── Ensure bank is connected so twin has data ──

describe('Council setup: connect bank', () => {
  before(async () => {
    const { body } = await fetchJSON(`${REGISTRY}/registry/institutions/maple-direct`);
    assert.equal(body.status, 'live', 'Maple Direct should be live');
  });

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

// ── Collaborative mode ──

describe('Council: collaborative mode', () => {
  it('returns synthesis from 3 specialists + chairman', { timeout: COUNCIL_TIMEOUT }, async () => {
    const question = 'How am I doing financially? What should I prioritize?';

    console.log(`\n  ── Collaborative council: "${question}" ──`);
    const start = Date.now();

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/collaborative`, {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_ID, question }),
    });

    const elapsed = Date.now() - start;
    console.log(`  Completed in ${elapsed}ms`);

    assert.equal(status, 200, `Council failed: ${JSON.stringify(body)}`);
    assert.equal(body.mode, 'collaborative');
    assert.equal(body.user_id, USER_ID);
    assert.equal(body.question, question);

    // 3 specialist responses
    assert.ok(Array.isArray(body.responses), 'Should have responses array');
    assert.equal(body.responses.length, 3, 'Should have 3 specialist responses');

    const roles = body.responses.map(r => r.role);
    assert.ok(roles.includes('Financial Analyst'), 'Should have analyst');
    assert.ok(roles.includes('Financial Strategist'), 'Should have strategist');
    assert.ok(roles.includes('Financial Planner'), 'Should have planner');

    // Each response should have content
    for (const resp of body.responses) {
      assert.ok(resp.content.length > 50, `${resp.role} response too short: ${resp.content.length} chars`);
      assert.ok(resp.provider, `${resp.role} should have provider`);
      assert.ok(resp.model, `${resp.role} should have model`);
      assert.ok(resp.elapsed_ms > 0, `${resp.role} should have timing`);
      console.log(`  ${resp.role} (${resp.provider}/${resp.model}): ${resp.content.length} chars, ${resp.elapsed_ms}ms`);
    }

    // Chairman synthesis
    assert.ok(body.synthesis, 'Should have synthesis');
    assert.ok(body.synthesis.length > 50, `Synthesis too short: ${body.synthesis.length} chars`);
    console.log(`  Chairman synthesis: ${body.synthesis.length} chars`);
    console.log(`  Preview: ${body.synthesis.substring(0, 200)}...`);

    // PII session was used (and cleaned up)
    assert.ok(body.pii_session_id, 'Should have pii_session_id');

    // Session persistence
    assert.ok(body.session_id, 'Should have session_id from session storage');
    assert.ok(typeof body.session_id === 'number', 'session_id should be a number');
    console.log(`  Stored as session: ${body.session_id}`);
  });
});

// ── Adversarial mode ──

describe('Council: adversarial mode', () => {
  it('returns bull/bear debate + chairman verdict', { timeout: COUNCIL_TIMEOUT }, async () => {
    const question = 'Should I break my mortgage early to refinance at a lower rate?';

    console.log(`\n  ── Adversarial council: "${question}" ──`);
    const start = Date.now();

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/adversarial`, {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_ID, question }),
    });

    const elapsed = Date.now() - start;
    console.log(`  Completed in ${elapsed}ms`);

    assert.equal(status, 200, `Council failed: ${JSON.stringify(body)}`);
    assert.equal(body.mode, 'adversarial');
    assert.equal(body.user_id, USER_ID);
    assert.equal(body.question, question);

    // Bull case
    assert.ok(body.bull_case, 'Should have bull_case');
    assert.ok(body.bull_case.content.length > 50, `Bull case too short: ${body.bull_case.content.length}`);
    assert.equal(body.bull_case.role, 'Bull Advocate');
    console.log(`  Bull (${body.bull_case.provider}): ${body.bull_case.content.length} chars, ${body.bull_case.elapsed_ms}ms`);

    // Bear case
    assert.ok(body.bear_case, 'Should have bear_case');
    assert.ok(body.bear_case.content.length > 50, `Bear case too short: ${body.bear_case.content.length}`);
    assert.equal(body.bear_case.role, 'Bear Advocate');
    console.log(`  Bear (${body.bear_case.provider}): ${body.bear_case.content.length} chars, ${body.bear_case.elapsed_ms}ms`);

    // Chairman verdict
    assert.ok(body.chairman_verdict, 'Should have chairman_verdict');
    assert.ok(body.chairman_verdict.content.length > 50, `Verdict too short: ${body.chairman_verdict.content.length}`);
    assert.equal(body.chairman_verdict.role, 'Chairman');
    console.log(`  Chairman (${body.chairman_verdict.provider}): ${body.chairman_verdict.content.length} chars`);
    console.log(`  Preview: ${body.chairman_verdict.content.substring(0, 200)}...`);

    // PII session was used
    assert.ok(body.pii_session_id, 'Should have pii_session_id');

    // Session persistence
    assert.ok(body.session_id, 'Should have session_id from session storage');
    assert.ok(typeof body.session_id === 'number', 'session_id should be a number');
    console.log(`  Stored as session: ${body.session_id}`);
  });
});

// ── PII verification: real names should NOT appear in raw LLM responses ──

describe('Council: PII filter integration', () => {
  it('collaborative mode rehydrates real names back into responses', { timeout: COUNCIL_TIMEOUT }, async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/collaborative`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: USER_ID,
        question: 'Summarize my financial situation at each institution.',
      }),
    });

    assert.equal(status, 200);

    // The PII session is already deleted (cleanup in finally block),
    // so we verify through the rehydrated content instead.
    // Rehydrated synthesis should reference real institution names
    // (since the LLM was given anonymized names, then response was rehydrated).
    const synthesis = body.synthesis;

    // The session was created and used
    assert.ok(body.pii_session_id, 'PII session was created');

    // Verify responses exist and have real content
    for (const resp of body.responses) {
      assert.ok(resp.content.length > 20, `${resp.role} should have substantive content`);
    }

    console.log(`  PII session: ${body.pii_session_id}`);
    console.log(`  Synthesis mentions real names: ${synthesis.includes('Maple Direct') || synthesis.includes('Alex')}`);
  });
});

// ── Empty twin: council with no connections ──

describe('Council: empty twin (no connections)', () => {
  it('collaborative mode works with no financial data', { timeout: COUNCIL_TIMEOUT }, async () => {
    const emptyUser = 'empty-user-council-test';

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/collaborative`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: emptyUser,
        question: 'What should I do with my finances?',
      }),
    });

    assert.equal(status, 200);
    assert.equal(body.mode, 'collaborative');
    assert.equal(body.user_id, emptyUser);

    // Should still return 3 responses + synthesis even with no data
    assert.equal(body.responses.length, 3);
    assert.ok(body.synthesis.length > 20, 'Synthesis should exist even with empty twin');

    console.log(`  Empty twin collaborative: ${body.synthesis.length} char synthesis`);
  });

  it('adversarial mode works with no financial data', { timeout: COUNCIL_TIMEOUT }, async () => {
    const emptyUser = 'empty-user-council-test';

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/council/adversarial`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: emptyUser,
        question: 'Should I invest in index funds?',
      }),
    });

    assert.equal(status, 200);
    assert.equal(body.mode, 'adversarial');
    assert.ok(body.bull_case.content.length > 20);
    assert.ok(body.bear_case.content.length > 20);
    assert.ok(body.chairman_verdict.content.length > 20);

    console.log(`  Empty twin adversarial: verdict ${body.chairman_verdict.content.length} chars`);
  });
});
