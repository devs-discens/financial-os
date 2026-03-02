const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const FailureInjector = require('./failure-injector');
const errorMiddleware = require('../errors/error-middleware');

async function createTestApp() {
  const fi = new FailureInjector();
  const app = express();
  app.use(express.json());
  app.use(fi.middleware());
  app.use('/admin', fi.adminRouter());
  app.get('/fdx/v6/test', (req, res) => res.json({ ok: true }));
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use(errorMiddleware);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  return { url: `http://localhost:${port}`, fi, close: () => new Promise(r => server.close(r)) };
}

describe('FailureInjector', () => {
  let server;

  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  it('passes through when no failures active', async () => {
    server = await createTestApp();
    const res = await fetch(`${server.url}/fdx/v6/test`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
  });

  it('does not affect non-FDX routes', async () => {
    server = await createTestApp();
    server.fi.set('outage');
    const res = await fetch(`${server.url}/health`);
    assert.equal(res.status, 200);
  });

  it('injects rate-limit 429', async () => {
    server = await createTestApp();
    server.fi.set('rate-limit', { rate: 1.0, retryAfter: 30 });
    const res = await fetch(`${server.url}/fdx/v6/test`);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '30');
  });

  it('injects transient error 500', async () => {
    server = await createTestApp();
    server.fi.set('transient-error', { rate: 1.0 });
    const res = await fetch(`${server.url}/fdx/v6/test`);
    assert.equal(res.status, 500);
  });

  it('injects outage 503', async () => {
    server = await createTestApp();
    server.fi.set('outage', { rate: 1.0 });
    const res = await fetch(`${server.url}/fdx/v6/test`);
    assert.equal(res.status, 503);
  });

  it('injects token-expiry 401', async () => {
    server = await createTestApp();
    server.fi.set('token-expiry', { rate: 1.0 });
    const res = await fetch(`${server.url}/fdx/v6/test`);
    assert.equal(res.status, 401);
  });

  it('injects consent-revoked 403', async () => {
    server = await createTestApp();
    server.fi.set('consent-revoked', { rate: 1.0 });
    const res = await fetch(`${server.url}/fdx/v6/test`);
    assert.equal(res.status, 403);
  });

  it('admin: lists active failures', async () => {
    server = await createTestApp();
    server.fi.set('rate-limit', { rate: 0.5 });
    const res = await fetch(`${server.url}/admin/failure`);
    const body = await res.json();
    assert.ok(body['rate-limit']);
    assert.equal(body['rate-limit'].rate, 0.5);
  });

  it('admin: activates failure via POST', async () => {
    server = await createTestApp();
    const res = await fetch(`${server.url}/admin/failure/outage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: 1.0 }),
    });
    const body = await res.json();
    assert.equal(body.status, 'activated');
    assert.equal(body.type, 'outage');
  });

  it('admin: clears specific failure via DELETE', async () => {
    server = await createTestApp();
    server.fi.set('outage');
    const res = await fetch(`${server.url}/admin/failure/outage`, { method: 'DELETE' });
    const body = await res.json();
    assert.equal(body.status, 'cleared');

    // Should pass through now
    const res2 = await fetch(`${server.url}/fdx/v6/test`);
    assert.equal(res2.status, 200);
  });

  it('admin: clears all failures via DELETE', async () => {
    server = await createTestApp();
    server.fi.set('outage');
    server.fi.set('rate-limit');
    const res = await fetch(`${server.url}/admin/failure`, { method: 'DELETE' });
    const body = await res.json();
    assert.equal(body.status, 'all_cleared');

    const list = await fetch(`${server.url}/admin/failure`).then(r => r.json());
    assert.deepEqual(list, {});
  });
});
