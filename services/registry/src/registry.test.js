const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// We need a fresh module for each test suite since institutions is mutable
function loadApp() {
  // Clear the module cache to get fresh state
  const modPath = require.resolve('./index');
  delete require.cache[modPath];
  return require('./index');
}

describe('Open Banking Registry', () => {
  let server, url, mod;

  before(async () => {
    mod = loadApp();
    server = http.createServer(mod.app);
    await new Promise(resolve => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await new Promise(r => server.close(r));
  });

  beforeEach(() => {
    // Reset institution states between tests
    const insts = mod.institutions;
    insts.get('maple-direct').status = 'live';
    insts.get('heritage-financial').status = 'pending';
    insts.get('heritage-financial').goLiveAt = null;
    insts.get('heritage-financial').wellKnown = null;
    insts.get('frontier-business').status = 'not_registered';
    insts.get('frontier-business').registeredAt = null;
    insts.get('frontier-business').goLiveAt = null;
  });

  it('health check returns registry info', async () => {
    const res = await fetch(`${url}/health`).then(r => r.json());
    assert.equal(res.service, 'open-banking-registry');
    assert.equal(res.status, 'ok');
  });

  it('lists 3 institutions', async () => {
    const res = await fetch(`${url}/registry/institutions`).then(r => r.json());
    assert.equal(res.institutions.length, 3);
    assert.equal(res.total, 3);
  });

  it('institutions have correct initial statuses', async () => {
    const res = await fetch(`${url}/registry/institutions`).then(r => r.json());
    const byId = Object.fromEntries(res.institutions.map(i => [i.id, i]));

    assert.equal(byId['maple-direct'].status, 'live');
    assert.equal(byId['heritage-financial'].status, 'pending');
    assert.equal(byId['frontier-business'].status, 'not_registered');
  });

  it('gets single institution by id', async () => {
    const res = await fetch(`${url}/registry/institutions/maple-direct`).then(r => r.json());
    assert.equal(res.id, 'maple-direct');
    assert.equal(res.name, 'Maple Direct');
    assert.equal(res.status, 'live');
  });

  it('returns 404 for unknown institution', async () => {
    const res = await fetch(`${url}/registry/institutions/nonexistent`);
    assert.equal(res.status, 404);
  });

  it('registers frontier-business (not_registered → pending)', async () => {
    const res = await fetch(`${url}/registry/institutions/frontier-business/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: ['ACCOUNT_BASIC', 'ACCOUNT_DETAILED', 'TRANSACTIONS'] }),
    });
    const body = await res.json();
    assert.equal(body.status, 'registered');
    assert.equal(body.institution.status, 'pending');
    assert.ok(body.institution.registeredAt);
  });

  it('rejects register on non-not_registered institution', async () => {
    const res = await fetch(`${url}/registry/institutions/maple-direct/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 400);
  });

  it('go-live heritage-financial (pending → live)', async () => {
    const res = await fetch(`${url}/registry/institutions/heritage-financial/go-live`, {
      method: 'POST',
    });
    const body = await res.json();
    assert.equal(body.status, 'live');
    assert.equal(body.institution.status, 'live');
    assert.ok(body.institution.goLiveAt);
  });

  it('rejects go-live on non-pending institution', async () => {
    const res = await fetch(`${url}/registry/institutions/maple-direct/go-live`, {
      method: 'POST',
    });
    assert.equal(res.status, 400);
  });

  it('SSE events endpoint connects and sends initial event', async () => {
    // Use AbortController to close the connection
    const controller = new AbortController();
    const res = await fetch(`${url}/registry/events`, { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');

    // Read the first chunk (connected event)
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('"type":"connected"'), 'Should receive connected event');

    controller.abort();
  });

  it('SSE receives status change event on go-live', async () => {
    const controller = new AbortController();
    const res = await fetch(`${url}/registry/events`, { signal: controller.signal });
    const reader = res.body.getReader();

    // Read connected event
    await reader.read();

    // Trigger a go-live
    await fetch(`${url}/registry/institutions/heritage-financial/go-live`, { method: 'POST' });

    // Read the status change event
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('"type":"status_change"'), 'Should receive status_change event');
    assert.ok(text.includes('"newStatus":"live"'));

    controller.abort();
  });

  it('full lifecycle: register → go-live', async () => {
    // Register
    const regRes = await fetch(`${url}/registry/institutions/frontier-business/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(r => r.json());
    assert.equal(regRes.institution.status, 'pending');

    // Go live
    const liveRes = await fetch(`${url}/registry/institutions/frontier-business/go-live`, {
      method: 'POST',
    }).then(r => r.json());
    assert.equal(liveRes.institution.status, 'live');

    // Verify final state
    const inst = await fetch(`${url}/registry/institutions/frontier-business`).then(r => r.json());
    assert.equal(inst.status, 'live');
    assert.ok(inst.goLiveAt);
  });
});
