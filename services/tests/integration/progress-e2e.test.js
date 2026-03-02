/**
 * Progress E2E Integration Tests
 *
 * Tests the Positive Progress — Gamified Financial Wellness feature.
 * Requires all Docker containers running and healthy.
 * Uses alex-chen (connected via admin demo) as the test user.
 *
 * Run: node --test tests/integration/progress-e2e.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const ORCHESTRATOR = 'http://localhost:3020';

let adminToken;

async function fetchJSON(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
  const resp = await fetch(url, { ...options, headers });
  const body = await resp.json();
  return { status: resp.status, body };
}

async function fetchAnon(url) {
  const resp = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  return { status: resp.status, body: await resp.json() };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Setup ----

describe('Progress: setup', { timeout: 60_000 }, () => {
  before(async () => {
    // Login as admin
    const { body } = await fetchJSON(`${ORCHESTRATOR}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    adminToken = body.access_token;
    assert.ok(adminToken, 'admin login should succeed');
  });

  it('should connect alex-chen via admin demo', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/admin/demo/connect`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 'alex-chen', institution_id: 'maple-direct' }),
    });
    assert.equal(status, 200);
    assert.ok(
      body.status === 'connected' || body.status === 'already_connected',
      `expected connected or already_connected, got ${body.status}`,
    );
  });

  it('should trigger a background poll to compute metrics', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/background/trigger`, { method: 'POST' });
    assert.equal(status, 200);
    // Wait for poll cycle to complete
    await sleep(5000);
  });
});

// ---- Progress snapshot ----

describe('Progress: snapshot', () => {
  it('GET /progress/alex-chen should return full progress snapshot', async () => {
    const { status, body } = await fetchAnon(`${ORCHESTRATOR}/progress/alex-chen`);
    assert.equal(status, 200);

    // Core fields
    assert.equal(body.user_id, 'alex-chen');
    assert.equal(typeof body.progress_score, 'number');
    assert.ok(body.progress_score >= 0 && body.progress_score <= 100, `score ${body.progress_score} in range`);
    assert.ok(body.progress_tier, 'should have tier');
    assert.ok(body.tier_quote, 'should have tier quote');
    assert.equal(typeof body.points_to_next, 'number');

    // Score components
    assert.ok(body.score_components, 'should have score_components');
    assert.equal(typeof body.score_components.savings_rate, 'number');
    assert.equal(typeof body.score_components.emergency_fund, 'number');
    assert.equal(typeof body.score_components.dti_trend, 'number');
    assert.equal(typeof body.score_components.credit_utilization, 'number');
    assert.equal(typeof body.score_components.consistency, 'number');

    // Metrics
    assert.ok(body.metrics, 'should have metrics');
    assert.equal(typeof body.metrics.savings_rate, 'number');
    assert.equal(typeof body.metrics.emergency_fund_months, 'number');
    assert.equal(typeof body.metrics.credit_utilization, 'number');
    assert.equal(typeof body.metrics.dti, 'number');

    // Details
    assert.ok(body.details, 'should have details');
    assert.equal(typeof body.details.liquid_deposits, 'number');
    assert.equal(typeof body.details.total_credit_used, 'number');

    // Benchmarks
    assert.ok(body.benchmarks, 'should have benchmarks');
    assert.ok(body.benchmarks.national, 'should have national benchmark');
    assert.ok(body.benchmarks.peer, 'should have peer benchmark');
    assert.equal(typeof body.benchmarks.national.median_savings_rate, 'number');
    assert.equal(typeof body.benchmarks.peer.peer_savings_rate, 'number');
    assert.ok(body.benchmarks.peer.peer_description, 'should have peer description');
    assert.ok(body.benchmarks.peer.peer_count > 0, 'should have peer count');

    // Recent milestones (array)
    assert.ok(Array.isArray(body.recent_milestones), 'should have recent_milestones array');

    // Streaks (array)
    assert.ok(Array.isArray(body.streaks), 'should have streaks array');

    console.log(`  Progress: score=${body.progress_score} tier=${body.progress_tier}`);
    console.log(`  Metrics: savings=${(body.metrics.savings_rate * 100).toFixed(1)}% emergency=${body.metrics.emergency_fund_months}mo credit_util=${(body.metrics.credit_utilization * 100).toFixed(1)}%`);
    console.log(`  Peer group: ${body.benchmarks.peer.peer_description}`);
  });

  it('GET /progress/nonexistent-user should return empty/default data', async () => {
    const { status, body } = await fetchAnon(`${ORCHESTRATOR}/progress/nonexistent-user-progress`);
    assert.equal(status, 200);
    assert.equal(body.user_id, 'nonexistent-user-progress');
    assert.equal(typeof body.progress_score, 'number');
  });
});

// ---- Milestones ----

describe('Progress: milestones', () => {
  it('GET /progress/alex-chen/milestones should return milestones', async () => {
    const { status, body } = await fetchAnon(`${ORCHESTRATOR}/progress/alex-chen/milestones`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.milestones), 'should have milestones array');
    assert.equal(typeof body.total, 'number');
    assert.ok(body.total >= 0, 'should have non-negative total');

    if (body.milestones.length > 0) {
      const m = body.milestones[0];
      assert.ok(m.id, 'milestone should have id');
      assert.ok(m.milestone_type, 'milestone should have type');
      assert.ok(m.milestone_key, 'milestone should have key');
      assert.ok(m.achieved_at, 'milestone should have achieved_at');
      assert.equal(typeof m.acknowledged, 'boolean');
      console.log(`  Found ${body.milestones.length} milestones (total: ${body.total})`);
      console.log(`  First: ${m.milestone_key} (${m.milestone_type})`);
    } else {
      console.log('  No milestones yet');
    }
  });

  it('GET /progress/alex-chen/milestones?unacknowledged_only=true should filter', async () => {
    const { status, body } = await fetchAnon(
      `${ORCHESTRATOR}/progress/alex-chen/milestones?unacknowledged_only=true`,
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.milestones));
    // All returned should be unacknowledged
    for (const m of body.milestones) {
      assert.equal(m.acknowledged, false, `milestone ${m.milestone_key} should be unacknowledged`);
    }
  });

  it('POST acknowledge should mark milestone as seen', async () => {
    // Get an unacknowledged milestone
    const { body: list } = await fetchAnon(
      `${ORCHESTRATOR}/progress/alex-chen/milestones?unacknowledged_only=true`,
    );

    if (list.milestones.length === 0) {
      console.log('  Skipping — no unacknowledged milestones');
      return;
    }

    const milestoneId = list.milestones[0].id;
    const { status, body } = await fetchAnon(`${ORCHESTRATOR}/progress/alex-chen/milestones/${milestoneId}/acknowledge`);
    // fetchAnon uses GET, we need POST
    const postResp = await fetch(
      `${ORCHESTRATOR}/progress/alex-chen/milestones/${milestoneId}/acknowledge`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    const postBody = await postResp.json();
    assert.equal(postResp.status, 200);
    assert.equal(postBody.acknowledged, true);
    assert.equal(postBody.milestone_id, milestoneId);
    console.log(`  Acknowledged milestone ${milestoneId}`);
  });

  it('POST acknowledge non-existent should 404', async () => {
    const resp = await fetch(
      `${ORCHESTRATOR}/progress/alex-chen/milestones/999999/acknowledge`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    assert.equal(resp.status, 404);
  });
});

// ---- Streaks ----

describe('Progress: streaks', () => {
  it('GET /progress/alex-chen/streaks should return streaks and personal bests', async () => {
    const { status, body } = await fetchAnon(`${ORCHESTRATOR}/progress/alex-chen/streaks`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.streaks), 'should have streaks array');
    assert.ok(Array.isArray(body.personal_bests), 'should have personal_bests array');

    if (body.streaks.length > 0) {
      const s = body.streaks[0];
      assert.ok(s.streak_type, 'streak should have type');
      assert.equal(typeof s.current_count, 'number');
      assert.equal(typeof s.longest_count, 'number');
      console.log(`  Streaks: ${body.streaks.map(s => `${s.streak_type}=${s.current_count}`).join(', ')}`);
    }

    if (body.personal_bests.length > 0) {
      console.log(`  Personal bests: ${body.personal_bests.map(p => p.milestone_key).join(', ')}`);
    }
  });
});

// ---- Benchmarks ----

describe('Progress: benchmarks', () => {
  it('GET /progress/alex-chen/benchmarks should return national + peer', async () => {
    const { status, body } = await fetchAnon(`${ORCHESTRATOR}/progress/alex-chen/benchmarks`);
    assert.equal(status, 200);
    assert.equal(body.user_id, 'alex-chen');

    // National
    assert.ok(body.national, 'should have national');
    assert.equal(body.national.age_bracket, '30-34', 'Alex is 34 → 30-34 bracket');
    assert.equal(body.national.income_bracket, '100k_125k', 'Alex earns $105k');
    assert.equal(body.national.province, 'ON');
    assert.equal(typeof body.national.median_savings_rate, 'number');
    assert.equal(typeof body.national.median_net_worth, 'number');

    // Peer
    assert.ok(body.peer, 'should have peer');
    assert.ok(body.peer.peer_description, 'should have peer description');
    assert.ok(body.peer.peer_count >= 8000, 'peer count should be >= 8000');
    assert.equal(body.peer.city, 'Toronto');
    assert.equal(body.peer.housing_status, 'Renting');
    assert.equal(body.peer.dependents, 0);

    console.log(`  National: savings_rate=${(body.national.median_savings_rate * 100).toFixed(1)}% net_worth=$${body.national.median_net_worth.toLocaleString()}`);
    console.log(`  Peer: ${body.peer.peer_description}`);
  });

  it('benchmarks for user without profile should use defaults', async () => {
    const { status, body } = await fetchAnon(`${ORCHESTRATOR}/progress/no-profile-user/benchmarks`);
    assert.equal(status, 200);
    assert.ok(body.national, 'should have national even without profile');
    assert.ok(body.peer, 'should have peer even without profile');
  });
});

// ---- Tier validation ----

describe('Progress: tier system', () => {
  it('tier should be one of the valid tiers', async () => {
    const validTiers = ['Starting Out', 'Building', 'Growing', 'Thriving', 'Flourishing'];
    const { body } = await fetchAnon(`${ORCHESTRATOR}/progress/alex-chen`);
    assert.ok(validTiers.includes(body.progress_tier), `${body.progress_tier} should be a valid tier`);
  });

  it('score components should sum to approximately the total score', async () => {
    const { body } = await fetchAnon(`${ORCHESTRATOR}/progress/alex-chen`);
    const weights = {
      savings_rate: 0.25,
      emergency_fund: 0.25,
      dti_trend: 0.20,
      credit_utilization: 0.15,
      consistency: 0.15,
    };

    let expectedScore = 0;
    for (const [key, weight] of Object.entries(weights)) {
      expectedScore += (body.score_components[key] || 0) * weight;
    }

    assert.ok(
      Math.abs(body.progress_score - expectedScore) < 1,
      `score ${body.progress_score} should be close to weighted sum ${expectedScore.toFixed(1)}`,
    );
  });
});
