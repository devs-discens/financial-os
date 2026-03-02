const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const TokenStore = require('../oauth/token-store');
const { createTokenMiddleware } = require('../oauth/token-middleware');
const AccountStore = require('../data/account-store');
const errorMiddleware = require('../errors/error-middleware');
const createWellKnownHandler = require('./well-known-handler');
const createAccountsHandler = require('./accounts-handler');
const createAccountDetailHandler = require('./account-detail-handler');
const createTransactionsHandler = require('./transactions-handler');
const createStatementsHandler = require('./statements-handler');
const createPaymentNetworksHandler = require('./payment-networks-handler');

// Helper: start a test server, return { url, close, token }
async function createTestServer() {
  const tokenStore = new TokenStore();
  const accountStore = new AccountStore();

  accountStore.addAccount({
    accountId: 'test-acct-001',
    accountCategory: 'DEPOSIT_ACCOUNT',
    accountType: 'CHECKING',
    displayName: 'Test Chequing',
    currentBalance: 1000,
  });
  accountStore.addAccount({
    accountId: 'test-acct-002',
    accountCategory: 'DEPOSIT_ACCOUNT',
    accountType: 'SAVINGS',
    displayName: 'Test Savings',
    currentBalance: 5000,
  });
  accountStore.addTransactions('test-acct-001', [
    { transactionId: 'tx-1', accountId: 'test-acct-001', transactionTimestamp: '2025-06-15T12:00:00Z', amount: 50, transactionType: 'DEBIT' },
    { transactionId: 'tx-2', accountId: 'test-acct-001', transactionTimestamp: '2025-06-10T12:00:00Z', amount: 30, transactionType: 'DEBIT' },
    { transactionId: 'tx-3', accountId: 'test-acct-001', transactionTimestamp: '2025-05-15T12:00:00Z', amount: 100, transactionType: 'CREDIT' },
  ]);
  accountStore.addStatements('test-acct-001', [
    { statementId: 'stmt-1', accountId: 'test-acct-001', description: 'June 2025', startDate: '2025-06-01', endDate: '2025-06-30' },
  ]);

  // Issue a valid token
  const consentId = tokenStore.createConsent('test-client', [
    'ACCOUNT_BASIC', 'ACCOUNT_DETAILED', 'TRANSACTIONS', 'STATEMENTS', 'BALANCES', 'PAYMENT_SUPPORT',
  ]);
  const code = tokenStore.createAuthCode('test-client', 'http://localhost/cb', [
    'ACCOUNT_BASIC', 'ACCOUNT_DETAILED', 'TRANSACTIONS', 'STATEMENTS', 'BALANCES', 'PAYMENT_SUPPORT',
  ], consentId);
  const tokens = tokenStore.exchangeAuthCode(code, 'test-client', 'http://localhost/cb');

  const app = express();
  app.use(express.json());

  app.get('/.well-known/fdx-configuration', createWellKnownHandler({
    institutionId: 'test-bank',
    institutionName: 'Test Bank',
    baseUrl: 'http://localhost',
  }));

  const auth = createTokenMiddleware(tokenStore);
  app.get('/fdx/v6/accounts', auth, ...createAccountsHandler(accountStore));
  app.get('/fdx/v6/accounts/:accountId', auth, ...createAccountDetailHandler(accountStore));
  app.get('/fdx/v6/accounts/:accountId/transactions', auth, ...createTransactionsHandler(accountStore));
  app.get('/fdx/v6/accounts/:accountId/statements', auth, ...createStatementsHandler(accountStore));
  app.get('/fdx/v6/accounts/:accountId/payment-networks', auth, ...createPaymentNetworksHandler(accountStore));
  app.use(errorMiddleware());

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  return {
    url: `http://localhost:${port}`,
    token: tokens.access_token,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

// Helper: HTTP GET with optional auth
async function get(url, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const body = await res.json();
  return { status: res.status, body };
}

describe('FDX Handlers', () => {
  let server;

  beforeEach(async () => {
    if (server) await server.close();
    server = await createTestServer();
  });

  // Clean up after all tests in this file
  it('well-known returns FDX discovery document', async () => {
    const { status, body } = await get(`${server.url}/.well-known/fdx-configuration`);
    assert.equal(status, 200);
    assert.equal(body.fdx_version, '6.0');
    assert.equal(body.institution_id, 'test-bank');
    assert.ok(body.authorization_endpoint);
    assert.ok(body.token_endpoint);
    assert.ok(Array.isArray(body.scopes_supported));
    await server.close();
    server = null;
  });

  it('accounts requires auth', async () => {
    const { status } = await get(`${server.url}/fdx/v6/accounts`);
    assert.equal(status, 401);
    await server.close();
    server = null;
  });

  it('lists accounts with valid token', async () => {
    const { status, body } = await get(`${server.url}/fdx/v6/accounts`, server.token);
    assert.equal(status, 200);
    assert.equal(body.accounts.length, 2);
    assert.ok(body.page);
    assert.equal(body.page.totalElements, 2);
    await server.close();
    server = null;
  });

  it('gets account detail', async () => {
    const { status, body } = await get(`${server.url}/fdx/v6/accounts/test-acct-001`, server.token);
    assert.equal(status, 200);
    assert.equal(body.accountId, 'test-acct-001');
    assert.equal(body.displayName, 'Test Chequing');
    await server.close();
    server = null;
  });

  it('returns 404 for unknown account', async () => {
    const { status, body } = await get(`${server.url}/fdx/v6/accounts/nonexistent`, server.token);
    assert.equal(status, 404);
    assert.equal(body.code, 701);
    await server.close();
    server = null;
  });

  it('lists transactions', async () => {
    const { status, body } = await get(`${server.url}/fdx/v6/accounts/test-acct-001/transactions`, server.token);
    assert.equal(status, 200);
    assert.equal(body.transactions.length, 3);
    assert.equal(body.page.totalElements, 3);
    await server.close();
    server = null;
  });

  it('filters transactions by date range', async () => {
    const { status, body } = await get(
      `${server.url}/fdx/v6/accounts/test-acct-001/transactions?startTime=2025-06-01&endTime=2025-06-30`,
      server.token
    );
    assert.equal(status, 200);
    assert.equal(body.transactions.length, 2);
    await server.close();
    server = null;
  });

  it('paginates transactions', async () => {
    const { status, body } = await get(
      `${server.url}/fdx/v6/accounts/test-acct-001/transactions?limit=2`,
      server.token
    );
    assert.equal(status, 200);
    assert.equal(body.transactions.length, 2);
    assert.equal(body.page.nextOffset, '2');
    assert.equal(body.page.totalElements, 3);
    await server.close();
    server = null;
  });

  it('gets statements', async () => {
    const { status, body } = await get(`${server.url}/fdx/v6/accounts/test-acct-001/statements`, server.token);
    assert.equal(status, 200);
    assert.equal(body.statements.length, 1);
    assert.equal(body.statements[0].statementId, 'stmt-1');
    await server.close();
    server = null;
  });

  it('gets payment networks', async () => {
    const { status, body } = await get(`${server.url}/fdx/v6/accounts/test-acct-001/payment-networks`, server.token);
    assert.equal(status, 200);
    assert.ok(body.paymentNetworks.length >= 1);
    await server.close();
    server = null;
  });
});
