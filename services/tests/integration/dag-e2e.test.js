/**
 * E2E tests for the Action DAG Engine (Component 8).
 * Tests run against live Docker containers:
 *   - orchestrator:3020, pii-filter:3030, maple-direct:3001, postgres:5433
 *
 * DAG generation tests make REAL external LLM calls (~15-30s per call)
 * and require API keys in .env.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const ORCHESTRATOR = 'http://localhost:3020';
const REGISTRY = 'http://localhost:3010';

const USER_ID = 'alex-chen';

// DAG generation involves LLM + PII pipeline
const DAG_TIMEOUT = 120_000;

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

// ── Prerequisites ──

describe('DAG prerequisites', () => {
  it('orchestrator is healthy', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/health`);
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });
});

// ── Ensure bank is connected ──

describe('DAG setup: connect bank', () => {
  before(async () => {
    const { body } = await fetchJSON(`${REGISTRY}/registry/institutions/maple-direct`);
    assert.equal(body.status, 'live');
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

// ── DAG Generation ──

let generatedDagId;

describe('DAG: generate', () => {
  it('generates a DAG from a financial question', { timeout: DAG_TIMEOUT }, async () => {
    const question = 'How should I pay down my credit card debt and start saving for a home?';

    console.log(`\n  ── DAG generation: "${question}" ──`);
    const start = Date.now();

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags/generate`, {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_ID, question }),
    });

    const elapsed = Date.now() - start;
    console.log(`  Generated in ${elapsed}ms`);

    assert.equal(status, 200, `DAG generation failed: ${JSON.stringify(body)}`);
    assert.ok(body.dag_id, 'Should have dag_id');
    assert.equal(body.user_id, USER_ID);
    assert.ok(body.title, 'Should have title');
    assert.equal(body.status, 'draft');

    // Nodes
    assert.ok(Array.isArray(body.nodes), 'Should have nodes array');
    assert.ok(body.nodes.length >= 2, `Should have at least 2 nodes, got ${body.nodes.length}`);

    for (const node of body.nodes) {
      assert.ok(node.node_key, 'Node should have node_key');
      assert.ok(node.title, 'Node should have title');
      assert.ok(
        ['check', 'transfer', 'allocate', 'council', 'manual'].includes(node.node_type),
        `Invalid node_type: ${node.node_type}`,
      );
      assert.ok(
        ['auto', 'manual', 'approval_required'].includes(node.execution_type),
        `Invalid execution_type: ${node.execution_type}`,
      );
      assert.ok(Array.isArray(node.depends_on), 'depends_on should be array');
      console.log(`  Node: ${node.node_key} (${node.node_type}/${node.execution_type}) — ${node.title}`);
    }

    // Steps
    assert.ok(Array.isArray(body.steps), 'Should have steps array');
    assert.ok(body.steps.length >= 5, `Should have at least 5 steps, got ${body.steps.length}`);
    for (const step of body.steps) {
      assert.ok(step.ts, 'Step should have timestamp');
      assert.ok(step.action, 'Step should have action');
      assert.ok(step.detail, 'Step should have detail');
    }
    console.log(`  Steps: ${body.steps.length} thinking steps recorded`);

    generatedDagId = body.dag_id;
  });
});

// ── Get DAG ──

describe('DAG: get', () => {
  it('retrieves a DAG by ID', async () => {
    if (!generatedDagId) {
      console.log('  Skipping — no DAG generated');
      return;
    }

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags/${generatedDagId}`);
    assert.equal(status, 200);
    assert.equal(body.dag_id, generatedDagId);
    assert.ok(body.title);
    assert.ok(Array.isArray(body.nodes));
    assert.ok(body.nodes.length > 0);
    assert.ok(body.created_at);
  });

  it('returns 404 for non-existent DAG', async () => {
    const { status } = await fetchJSON(`${ORCHESTRATOR}/dags/99999`);
    assert.equal(status, 404);
  });
});

// ── Approve nodes ──

describe('DAG: approve', () => {
  it('approves specific nodes', async () => {
    if (!generatedDagId) {
      console.log('  Skipping — no DAG generated');
      return;
    }

    // Get the DAG to find node keys
    const { body: dag } = await fetchJSON(`${ORCHESTRATOR}/dags/${generatedDagId}`);
    const nodeKeys = dag.nodes.map(n => n.node_key);

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags/${generatedDagId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ node_keys: nodeKeys }),
    });

    assert.equal(status, 200);
    assert.ok(body.approved > 0, `Should have approved at least 1 node, got ${body.approved}`);
    assert.equal(body.requested, nodeKeys.length);

    // Verify nodes are now approved
    const approvedNodes = body.dag.nodes.filter(n => n.status === 'approved');
    assert.ok(approvedNodes.length > 0, 'Should have approved nodes');

    console.log(`  Approved ${body.approved}/${body.requested} nodes`);
  });
});

// ── Execute DAG ──

describe('DAG: execute', () => {
  it('executes approved nodes in dependency order', { timeout: DAG_TIMEOUT }, async () => {
    if (!generatedDagId) {
      console.log('  Skipping — no DAG generated');
      return;
    }

    console.log(`\n  ── DAG execution: id=${generatedDagId} ──`);
    const start = Date.now();

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags/${generatedDagId}/execute`, {
      method: 'POST',
    });

    const elapsed = Date.now() - start;
    console.log(`  Executed in ${elapsed}ms`);

    assert.equal(status, 200);
    assert.equal(body.dag_id, generatedDagId);
    assert.ok(['completed', 'failed'].includes(body.status), `Unexpected status: ${body.status}`);

    // Results
    assert.ok(Array.isArray(body.results), 'Should have results array');
    assert.ok(body.results.length > 0, 'Should have at least 1 result');

    for (const result of body.results) {
      assert.ok(result.node_key, 'Result should have node_key');
      assert.ok(result.status, 'Result should have status');
      console.log(`  Result: ${result.node_key} → ${result.status}`);
    }

    // Steps
    assert.ok(Array.isArray(body.steps), 'Should have execution steps');
    assert.ok(body.steps.length > 0);
    console.log(`  Execution steps: ${body.steps.length}`);
  });
});

// ── List DAGs ──

describe('DAG: list', () => {
  it('lists DAGs for user', async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags?user_id=${USER_ID}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.dags));

    if (generatedDagId) {
      assert.ok(body.dags.length > 0, 'Should have at least the generated DAG');
      const found = body.dags.find(d => d.dag_id === generatedDagId);
      assert.ok(found, 'Should find the generated DAG in list');
      assert.ok(found.title);
      assert.ok(found.node_count > 0);
    }

    console.log(`  Listed ${body.dags.length} DAGs for ${USER_ID}`);
  });
});

// ── DAG with council synthesis ──

describe('DAG: with council synthesis', () => {
  it('generates DAG using council synthesis as input', { timeout: DAG_TIMEOUT }, async () => {
    const question = 'What should I do about my credit card debt?';
    const synthesis = 'The council recommends aggressively paying down credit card debt before saving, '
      + 'starting with the highest-rate card. Transfer available TFSA funds if needed.';

    console.log(`\n  ── DAG with synthesis: "${question}" ──`);
    const start = Date.now();

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags/generate`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: USER_ID,
        question,
        council_synthesis: synthesis,
      }),
    });

    const elapsed = Date.now() - start;
    console.log(`  Generated in ${elapsed}ms`);

    assert.equal(status, 200, `DAG generation failed: ${JSON.stringify(body)}`);
    assert.ok(body.dag_id);
    assert.ok(body.nodes.length >= 2, `Should have at least 2 nodes, got ${body.nodes.length}`);

    console.log(`  Title: ${body.title}`);
    console.log(`  Nodes: ${body.nodes.length}`);
    for (const node of body.nodes) {
      console.log(`    ${node.node_key}: ${node.title} (${node.node_type})`);
    }
  });
});

// ── Archive DAG ──

let archiveDagId;

describe('DAG: archive', () => {
  it('creates a DAG to archive', { timeout: DAG_TIMEOUT }, async () => {
    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags/generate`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: USER_ID,
        question: 'How should I start budgeting for next year?',
      }),
    });

    assert.equal(status, 200);
    assert.ok(body.dag_id);
    archiveDagId = body.dag_id;

    console.log(`  Created DAG ${archiveDagId} for archive test`);
  });

  it('archives a DAG via DELETE', async () => {
    assert.ok(archiveDagId, 'Need DAG ID from creation test');

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags/${archiveDagId}`, {
      method: 'DELETE',
    });

    assert.equal(status, 200);
    assert.equal(body.status, 'archived');
    assert.equal(body.dag_id, archiveDagId);

    console.log(`  Archived DAG ${archiveDagId}`);
  });

  it('archived DAG excluded from list', async () => {
    assert.ok(archiveDagId, 'Need archived DAG ID');

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags?user_id=${USER_ID}`);

    assert.equal(status, 200);
    const found = body.dags.find(d => d.dag_id === archiveDagId);
    assert.ok(!found, `Archived DAG ${archiveDagId} should not appear in list`);

    console.log(`  DAG list: ${body.dags.length} DAGs, archived DAG excluded`);
  });

  it('returns 404 for already-archived DAG', async () => {
    assert.ok(archiveDagId, 'Need archived DAG ID');

    const { status } = await fetchJSON(`${ORCHESTRATOR}/dags/${archiveDagId}`, {
      method: 'DELETE',
    });

    assert.equal(status, 404, 'Should get 404 for already-archived DAG');
  });
});

// ── Empty twin ──

describe('DAG: empty twin', () => {
  it('generates valid DAG with no financial data', { timeout: DAG_TIMEOUT }, async () => {
    const emptyUser = 'empty-user-dag-test';

    const { status, body } = await fetchJSON(`${ORCHESTRATOR}/dags/generate`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: emptyUser,
        question: 'How should I start budgeting?',
      }),
    });

    assert.equal(status, 200, `DAG generation failed: ${JSON.stringify(body)}`);
    assert.ok(body.dag_id);
    assert.ok(body.nodes.length >= 1, 'Should have at least 1 node even with empty twin');
    assert.ok(body.steps.length >= 5, 'Should have thinking steps');

    console.log(`  Empty twin DAG: ${body.nodes.length} nodes, ${body.steps.length} steps`);
  });
});
