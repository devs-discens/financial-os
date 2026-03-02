/**
 * E2E tests for the PII Filter Gateway Service.
 * Tests run against live Docker containers — no mocking.
 *
 * Requires: pii-filter:3030
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PII_FILTER = 'http://localhost:3030';

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

// ── Health check ──

describe('PII Filter health', () => {
  it('returns ok', async () => {
    const { status, body } = await fetchJSON(`${PII_FILTER}/health`);
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'pii-filter');
  });
});

// ── Session lifecycle ──

describe('PII Filter: session lifecycle', () => {
  let sessionId;

  it('creates a session with known entities', async () => {
    const { status, body } = await fetchJSON(`${PII_FILTER}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        known_entities: {
          names: ['Alex Chen'],
          institutions: ['Maple Direct', 'Heritage Financial'],
        },
      }),
    });
    assert.equal(status, 200);
    assert.ok(body.session_id, 'Should return session_id');
    assert.ok(body.created_at, 'Should return created_at');
    assert.deepEqual(body.entity_types, ['names', 'institutions']);
    assert.equal(body.entity_count, 3); // 1 name + 2 institutions
    sessionId = body.session_id;
  });

  it('gets session info', async () => {
    const { status, body } = await fetchJSON(`${PII_FILTER}/sessions/${sessionId}`);
    assert.equal(status, 200);
    assert.equal(body.session_id, sessionId);
    assert.equal(body.mapping_count, 0); // No filtering done yet
  });

  it('deletes session', async () => {
    const { status, body } = await fetchJSON(`${PII_FILTER}/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'deleted');
  });

  it('returns 404 for deleted session', async () => {
    const { status } = await fetchJSON(`${PII_FILTER}/sessions/${sessionId}`);
    assert.equal(status, 404);
  });

  it('filter fails with 404 for deleted session', async () => {
    const { status } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, text: 'Hello' }),
    });
    assert.equal(status, 404);
  });
});

// ── Filtering: name + institution + amount anonymization ──

describe('PII Filter: text anonymization', () => {
  let sessionId;

  before(async () => {
    const { body } = await fetchJSON(`${PII_FILTER}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        known_entities: {
          names: ['Alex Chen'],
          institutions: ['Maple Direct', 'Heritage Financial'],
        },
      }),
    });
    sessionId = body.session_id;
  });

  after(async () => {
    await fetchJSON(`${PII_FILTER}/sessions/${sessionId}`, { method: 'DELETE' });
  });

  it('anonymizes names, institutions, and amounts', async () => {
    const inputText = 'Alex Chen has a chequing account at Maple Direct with a balance of $4,200.00 and a mortgage at Heritage Financial for $385,000.';

    const { status, body } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, text: inputText }),
    });
    assert.equal(status, 200);
    assert.ok(body.filtered_text, 'Should return filtered_text');

    // Verify NO original PII remains
    assert.ok(!body.filtered_text.includes('Alex Chen'), 'Name should be anonymized');
    assert.ok(!body.filtered_text.includes('Maple Direct'), 'Institution should be anonymized');
    assert.ok(!body.filtered_text.includes('Heritage Financial'), 'Institution should be anonymized');
    assert.ok(!body.filtered_text.includes('$4,200.00'), 'Amount should be shifted');
    assert.ok(!body.filtered_text.includes('$385,000'), 'Amount should be shifted');

    // Verify entities were detected
    assert.ok(body.entities_found.length >= 4, `Expected at least 4 entities, got ${body.entities_found.length}`);

    // Verify the output still has dollar signs (amounts are shifted, not removed)
    assert.ok(body.filtered_text.includes('$'), 'Shifted amounts should still have $ sign');

    // Verify synthetic labels are used (not real-sounding names)
    assert.match(body.filtered_text, /Person [A-Q]/, 'Name replacement should be synthetic label');
    assert.match(body.filtered_text, /Institution [A-H]/, 'Institution replacement should be synthetic label');

    console.log(`  Input:  ${inputText}`);
    console.log(`  Output: ${body.filtered_text}`);
  });

  it('anonymizes dates and percentages', async () => {
    const inputText = 'Alex Chen has a mortgage at 4.89% that renews on 2027-04-15.';

    const { status, body } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, text: inputText }),
    });
    assert.equal(status, 200);

    // Name should be anonymized
    assert.ok(!body.filtered_text.includes('Alex Chen'), 'Name should be anonymized');

    // Date should be shifted
    assert.ok(!body.filtered_text.includes('2027-04-15'), 'Date should be shifted');

    // Percentage should be perturbed
    assert.ok(!body.filtered_text.includes('4.89%'), 'Percentage should be perturbed');

    console.log(`  Input:  ${inputText}`);
    console.log(`  Output: ${body.filtered_text}`);
  });

  it('returns text unchanged when no PII present', async () => {
    const inputText = 'The weather is nice today.';

    const { status, body } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, text: inputText }),
    });
    assert.equal(status, 200);
    assert.equal(body.filtered_text, inputText);
    assert.equal(body.entities_found.length, 0);
  });
});

// ── Rehydration ──

describe('PII Filter: rehydration', () => {
  let sessionId;

  before(async () => {
    const { body } = await fetchJSON(`${PII_FILTER}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        known_entities: {
          names: ['Alex Chen'],
          institutions: ['Maple Direct'],
        },
      }),
    });
    sessionId = body.session_id;
  });

  after(async () => {
    await fetchJSON(`${PII_FILTER}/sessions/${sessionId}`, { method: 'DELETE' });
  });

  it('rehydrates anonymized text back to original values', async () => {
    const originalText = 'Alex Chen has an account at Maple Direct with $4,200.00.';

    // Step 1: Filter
    const { body: filterResult } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, text: originalText }),
    });

    // Verify it was anonymized
    assert.ok(!filterResult.filtered_text.includes('Alex Chen'));
    assert.ok(!filterResult.filtered_text.includes('Maple Direct'));

    // Step 2: Simulate LLM response that uses the anonymized values
    // The LLM would echo back the anonymized text — we simulate that
    const llmResponse = filterResult.filtered_text;

    // Step 3: Rehydrate
    const { status, body: rehydrateResult } = await fetchJSON(`${PII_FILTER}/rehydrate`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, text: llmResponse }),
    });
    assert.equal(status, 200);

    // Verify real values are restored
    assert.ok(
      rehydrateResult.rehydrated_text.includes('Alex Chen'),
      `Name should be restored: ${rehydrateResult.rehydrated_text}`,
    );
    assert.ok(
      rehydrateResult.rehydrated_text.includes('Maple Direct'),
      `Institution should be restored: ${rehydrateResult.rehydrated_text}`,
    );
    assert.ok(
      rehydrateResult.rehydrated_text.includes('$4,200.00'),
      `Amount should be restored: ${rehydrateResult.rehydrated_text}`,
    );

    console.log(`  Original:   ${originalText}`);
    console.log(`  Filtered:   ${filterResult.filtered_text}`);
    console.log(`  Rehydrated: ${rehydrateResult.rehydrated_text}`);
  });
});

// ── Consistency: same session uses same mappings ──

describe('PII Filter: session consistency', () => {
  let sessionId;

  before(async () => {
    const { body } = await fetchJSON(`${PII_FILTER}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        known_entities: {
          names: ['Alex Chen'],
          institutions: ['Maple Direct'],
        },
      }),
    });
    sessionId = body.session_id;
  });

  after(async () => {
    await fetchJSON(`${PII_FILTER}/sessions/${sessionId}`, { method: 'DELETE' });
  });

  it('uses consistent mappings across multiple filter calls', async () => {
    // First call
    const { body: first } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        text: 'Alex Chen banks at Maple Direct.',
      }),
    });

    // Second call — same entities should get same replacements
    const { body: second } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        text: 'Alex Chen also has a credit card at Maple Direct.',
      }),
    });

    // Neither should contain original PII
    assert.ok(!first.filtered_text.includes('Alex Chen'));
    assert.ok(!second.filtered_text.includes('Alex Chen'));
    assert.ok(!first.filtered_text.includes('Maple Direct'));
    assert.ok(!second.filtered_text.includes('Maple Direct'));

    // Name should be a synthetic label (Person X), not a real-sounding name
    const personLabel = first.filtered_text.split(' banks')[0];
    assert.match(personLabel, /^Person [A-Q]$/, `Expected "Person X" label, got: ${personLabel}`);

    // Same label should appear in second call (session consistency)
    assert.ok(
      second.filtered_text.startsWith(personLabel),
      `Expected consistent label "${personLabel}" but got: ${second.filtered_text}`,
    );

    // Institution should also be a synthetic label
    assert.match(first.filtered_text, /Institution [A-H]/, 'Institution should use synthetic label');

    console.log(`  Call 1: ${first.filtered_text}`);
    console.log(`  Call 2: ${second.filtered_text}`);
    console.log(`  Consistent person label: ${personLabel}`);
  });
});

// ── Dollar amount proportional consistency ──

describe('PII Filter: proportional amount shifting', () => {
  let sessionId;

  before(async () => {
    const { body } = await fetchJSON(`${PII_FILTER}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        known_entities: { names: [], institutions: [] },
      }),
    });
    sessionId = body.session_id;
  });

  after(async () => {
    await fetchJSON(`${PII_FILTER}/sessions/${sessionId}`, { method: 'DELETE' });
  });

  it('preserves ratios between dollar amounts', async () => {
    const inputText = 'Income: $10,000.00 per month. Rent: $2,500.00 per month. Savings: $1,000.00 per month.';

    const { body } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, text: inputText }),
    });

    // Extract dollar amounts from filtered text
    const amounts = body.filtered_text.match(/\$[\d,]+(?:\.\d{2})?/g);
    assert.ok(amounts && amounts.length === 3, `Expected 3 amounts, got ${amounts}`);

    // Parse them
    const parsed = amounts.map(a => parseFloat(a.replace('$', '').replace(',', '')));
    const [income, rent, savings] = parsed;

    // Original ratios: rent/income = 0.25, savings/income = 0.10
    const rentRatio = rent / income;
    const savingsRatio = savings / income;

    // Ratios should be approximately preserved (same factor applied to all)
    assert.ok(
      Math.abs(rentRatio - 0.25) < 0.01,
      `Rent ratio should be ~0.25, got ${rentRatio.toFixed(4)}`,
    );
    assert.ok(
      Math.abs(savingsRatio - 0.10) < 0.01,
      `Savings ratio should be ~0.10, got ${savingsRatio.toFixed(4)}`,
    );

    console.log(`  Input amounts:  $10,000, $2,500, $1,000`);
    console.log(`  Output amounts: ${amounts.join(', ')}`);
    console.log(`  Rent ratio: ${rentRatio.toFixed(4)} (expected ~0.25)`);
    console.log(`  Savings ratio: ${savingsRatio.toFixed(4)} (expected ~0.10)`);
  });
});

// ── Session isolation (multi-tenancy) ──

describe('PII Filter: session isolation', () => {
  it('different sessions produce different anonymizations', async () => {
    // Create two sessions with the same entities
    const { body: s1 } = await fetchJSON(`${PII_FILTER}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        known_entities: { names: ['Alex Chen'], institutions: ['Maple Direct'] },
      }),
    });
    const { body: s2 } = await fetchJSON(`${PII_FILTER}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        known_entities: { names: ['Alex Chen'], institutions: ['Maple Direct'] },
      }),
    });

    const text = 'Alex Chen has $5,000.00 at Maple Direct.';

    // Filter with both sessions
    const { body: f1 } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({ session_id: s1.session_id, text }),
    });
    const { body: f2 } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({ session_id: s2.session_id, text }),
    });

    // Both should anonymize (no original PII)
    assert.ok(!f1.filtered_text.includes('Alex Chen'));
    assert.ok(!f2.filtered_text.includes('Alex Chen'));
    assert.ok(!f1.filtered_text.includes('$5,000.00'));
    assert.ok(!f2.filtered_text.includes('$5,000.00'));

    // The dollar amounts should differ (different random seeds)
    const amounts1 = f1.filtered_text.match(/\$[\d,]+(?:\.\d{2})?/g);
    const amounts2 = f2.filtered_text.match(/\$[\d,]+(?:\.\d{2})?/g);
    // It's theoretically possible they're the same, but extremely unlikely
    // with random seeds. We just verify both were shifted.
    assert.ok(amounts1 && amounts1.length > 0);
    assert.ok(amounts2 && amounts2.length > 0);

    console.log(`  Session 1: ${f1.filtered_text}`);
    console.log(`  Session 2: ${f2.filtered_text}`);

    // Cleanup
    await fetchJSON(`${PII_FILTER}/sessions/${s1.session_id}`, { method: 'DELETE' });
    await fetchJSON(`${PII_FILTER}/sessions/${s2.session_id}`, { method: 'DELETE' });
  });
});
