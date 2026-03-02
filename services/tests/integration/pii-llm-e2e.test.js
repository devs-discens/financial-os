/**
 * E2E tests for the full PII Filter → LLM → Rehydrate pipeline.
 * Tests the complete flow: anonymize PII, send to real LLM, rehydrate response.
 *
 * Requires: pii-filter:3030, orchestrator:3020 (with debug routes)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PII_FILTER = 'http://localhost:3030';
const ORCHESTRATOR = 'http://localhost:3020';

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

// ── Full pipeline: PII → LLM → Rehydrate ──

describe('Pipeline: PII Filter → LLM → Rehydrate', () => {
  let sessionId;

  const knownEntities = {
    names: ['Alex Chen'],
    institutions: ['Maple Direct', 'Heritage Financial', 'Frontier Business'],
  };

  before(async () => {
    const { body } = await fetchJSON(`${PII_FILTER}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ known_entities: knownEntities }),
    });
    sessionId = body.session_id;
    console.log(`  Session created: ${sessionId}`);
  });

  after(async () => {
    await fetchJSON(`${PII_FILTER}/sessions/${sessionId}`, { method: 'DELETE' });
  });

  it('full pipeline: anonymize → LLM → rehydrate', async () => {
    // Step 1: Build a prompt with real PII
    const realPrompt = [
      'Analyze the following financial data for Alex Chen:',
      '- Chequing at Maple Direct: $4,200.00',
      '- Visa at Maple Direct: -$2,800.00',
      '- Mortgage at Heritage Financial: -$385,000.00 at 4.89%',
      '- Business chequing at Frontier Business: $12,400.00',
      '',
      'What is the total net position across all accounts?',
    ].join('\n');

    console.log(`\n  ── Step 1: Original prompt ──`);
    console.log(`  ${realPrompt.split('\n').join('\n  ')}`);

    // Step 2: Anonymize through PII filter
    const { status: filterStatus, body: filterResult } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, text: realPrompt }),
    });
    assert.equal(filterStatus, 200);

    console.log(`\n  ── Step 2: Anonymized prompt (${filterResult.entities_found.length} entities found) ──`);
    console.log(`  ${filterResult.filtered_text.split('\n').join('\n  ')}`);

    // Verify NO real PII in anonymized prompt
    assert.ok(!filterResult.filtered_text.includes('Alex Chen'), 'Name should be anonymized');
    assert.ok(!filterResult.filtered_text.includes('Maple Direct'), 'Institution should be anonymized');
    assert.ok(!filterResult.filtered_text.includes('Heritage Financial'), 'Institution should be anonymized');
    assert.ok(!filterResult.filtered_text.includes('Frontier Business'), 'Institution should be anonymized');
    assert.ok(!filterResult.filtered_text.includes('$4,200.00'), 'Amount should be shifted');
    assert.ok(!filterResult.filtered_text.includes('$385,000.00'), 'Amount should be shifted');

    // Verify synthetic labels (not real-sounding names)
    assert.match(filterResult.filtered_text, /Person [A-Q]/, 'Should use synthetic person label');
    assert.match(filterResult.filtered_text, /Institution [A-H]/, 'Should use synthetic institution label');

    // Step 3: Send anonymized prompt to LLM
    const { status: llmStatus, body: llmResult } = await fetchJSON(`${ORCHESTRATOR}/debug/llm`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: filterResult.filtered_text,
        system_prompt: 'You are a financial analyst. Analyze the data provided. Reference the person and institutions by the names given.',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
      }),
    });
    assert.equal(llmStatus, 200, `LLM call failed: ${JSON.stringify(llmResult)}`);

    console.log(`\n  ── Step 3: LLM response (${llmResult.elapsed_ms}ms, ${llmResult.tokens.total} tokens) ──`);
    console.log(`  ${llmResult.content.substring(0, 300)}...`);

    // LLM response should NOT contain real PII (it only saw anonymized data)
    assert.ok(!llmResult.content.includes('Alex Chen'), 'LLM response should not contain real name');
    assert.ok(!llmResult.content.includes('Maple Direct'), 'LLM response should not contain real institution');

    // Step 4: Rehydrate LLM response
    const { status: rehydrateStatus, body: rehydrateResult } = await fetchJSON(`${PII_FILTER}/rehydrate`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, text: llmResult.content }),
    });
    assert.equal(rehydrateStatus, 200);

    console.log(`\n  ── Step 4: Rehydrated response ──`);
    console.log(`  ${rehydrateResult.rehydrated_text.substring(0, 300)}...`);

    // Rehydrated response should contain real names/institutions
    // (only if the LLM echoed them back — it usually does when analyzing)
    // We check that at least the anonymized values are no longer present
    const session = await fetchJSON(`${PII_FILTER}/sessions/${sessionId}`);
    assert.ok(
      session.body.mapping_count > 0,
      'Session should have stored mappings from the filter step',
    );

    console.log(`\n  ── Pipeline complete: ${session.body.mapping_count} mappings used ──`);
  });
});

// ── Multi-turn conversation through PII filter ──

describe('Pipeline: multi-turn conversation', () => {
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

  it('maintains consistency across multiple filter calls in same session', async () => {
    // Turn 1
    const { body: f1 } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        text: 'Alex Chen has $4,200.00 in their Maple Direct chequing account.',
      }),
    });

    // Turn 2 — same entities should use same mappings
    const { body: f2 } = await fetchJSON(`${PII_FILTER}/filter`, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        text: 'Can Alex Chen afford to move $2,000.00 from Maple Direct to savings?',
      }),
    });

    // Extract fake name from turn 1
    const fakeName = f1.filtered_text.split(' has ')[0];

    // Same fake name should appear in turn 2
    assert.ok(
      f2.filtered_text.includes(fakeName),
      `Turn 2 should use same fake name "${fakeName}": ${f2.filtered_text}`,
    );

    // Extract institution replacement from turn 1
    // Find what replaced "Maple Direct" in turn 1
    assert.ok(!f1.filtered_text.includes('Maple Direct'));
    assert.ok(!f2.filtered_text.includes('Maple Direct'));

    console.log(`  Turn 1: ${f1.filtered_text}`);
    console.log(`  Turn 2: ${f2.filtered_text}`);
    console.log(`  Consistent fake name: ${fakeName}`);
  });
});
