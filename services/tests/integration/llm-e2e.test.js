/**
 * E2E tests for the LLM client via the orchestrator's /debug/llm endpoint.
 * Tests run against live Docker containers — no mocking.
 *
 * Requires: orchestrator:3020 with LOG_LEVEL=DEBUG (debug routes enabled)
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

// ── Debug endpoint availability ──

describe('Debug LLM endpoint', () => {
  it('is available when LOG_LEVEL=DEBUG', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/debug/llm`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Say hello' }),
    });
    // Should get 200 (success) or 502 (LLM failure), not 404 (route missing)
    assert.notEqual(status, 404, 'Debug route should be registered');
  });
});

// ── Anthropic provider ──

describe('LLM: Anthropic provider', () => {
  it('returns valid response with token counts', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/debug/llm`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'What is 2 + 2? Reply with just the number.',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 64,
      }),
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.content, 'Should have content');
    assert.ok(body.content.includes('4'), `Expected "4" in response: ${body.content}`);
    assert.equal(body.provider, 'anthropic');
    assert.ok(body.tokens, 'Should have token counts');
    assert.ok(body.tokens.input > 0, 'Should have input tokens');
    assert.ok(body.tokens.output > 0, 'Should have output tokens');
    assert.ok(body.tokens.total > 0, 'Should have total tokens');
    assert.ok(body.elapsed_ms > 0, 'Should have elapsed_ms');
    console.log(`  Anthropic: ${body.elapsed_ms}ms, ${body.tokens.total} tokens`);
  });
});

// ── OpenAI provider ──

describe('LLM: OpenAI provider', () => {
  it('returns valid response with token counts', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/debug/llm`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'What is 2 + 2? Reply with just the number.',
        provider: 'openai',
        model: 'gpt-4o-mini',
        max_tokens: 64,
      }),
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.content, 'Should have content');
    assert.ok(body.content.includes('4'), `Expected "4" in response: ${body.content}`);
    assert.equal(body.provider, 'openai');
    assert.ok(body.tokens, 'Should have token counts');
    assert.ok(body.tokens.total > 0, 'Should have total tokens');
    assert.ok(body.elapsed_ms > 0, 'Should have elapsed_ms');
    console.log(`  OpenAI: ${body.elapsed_ms}ms, ${body.tokens.total} tokens`);
  });
});

// ── Gemini provider ──

describe('LLM: Gemini provider', () => {
  it('returns valid response with token counts', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/debug/llm`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'What is 2 + 2? Reply with just the number.',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        max_tokens: 64,
      }),
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.content, 'Should have content');
    assert.ok(body.content.includes('4'), `Expected "4" in response: ${body.content}`);
    assert.equal(body.provider, 'gemini');
    assert.ok(body.tokens, 'Should have token counts');
    assert.ok(body.elapsed_ms > 0, 'Should have elapsed_ms');
    console.log(`  Gemini: ${body.elapsed_ms}ms, ${body.tokens.total} tokens`);
  });
});

// ── System prompt respected ──

describe('LLM: system prompt', () => {
  it('respects system prompt (JSON response format)', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/debug/llm`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'What is the capital of Canada?',
        system_prompt: 'You must respond with valid JSON only. Format: {"answer": "..."}',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 64,
      }),
    });
    assert.equal(status, 200);
    // Try to parse the content as JSON
    let parsed;
    try {
      parsed = JSON.parse(body.content);
    } catch (e) {
      assert.fail(`Expected JSON response, got: ${body.content}`);
    }
    assert.ok(parsed.answer, 'Should have "answer" field');
    assert.ok(
      parsed.answer.toLowerCase().includes('ottawa'),
      `Expected "Ottawa" in answer: ${parsed.answer}`,
    );
  });
});

// ── Error handling ──

describe('LLM: error handling', () => {
  it('returns 400 for invalid provider with no API key', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/debug/llm`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'Hello',
        provider: 'nonexistent-provider',
      }),
    });
    assert.equal(status, 400);
    assert.ok(body.detail.includes('No API key'));
  });
});
