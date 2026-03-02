const express = require('express');
const cors = require('cors');
const { createLogger } = require('@financial-os/shared');

const PORT = process.env.PORT || 3010;
const log = createLogger('registry');

// Initial institution states — base URLs configurable via env for Docker networking
const MAPLE_URL = process.env.MAPLE_BASE_URL || 'http://localhost:3001';
const HERITAGE_URL = process.env.HERITAGE_BASE_URL || 'http://localhost:3002';
const FRONTIER_URL = process.env.FRONTIER_BASE_URL || 'http://localhost:3003';

const institutions = new Map([
  ['maple-direct', {
    id: 'maple-direct',
    name: 'Maple Direct',
    status: 'live',
    baseUrl: MAPLE_URL,
    fdxVersion: '6.0',
    capabilities: ['ACCOUNT_BASIC', 'ACCOUNT_DETAILED', 'TRANSACTIONS', 'BALANCES', 'PAYMENT_SUPPORT'],
    registeredAt: '2025-06-01T00:00:00Z',
    goLiveAt: '2025-09-01T00:00:00Z',
    wellKnown: null,
  }],
  ['heritage-financial', {
    id: 'heritage-financial',
    name: 'Heritage Financial',
    status: 'pending',
    baseUrl: HERITAGE_URL,
    fdxVersion: '6.0',
    capabilities: ['ACCOUNT_BASIC', 'ACCOUNT_DETAILED', 'STATEMENTS', 'BALANCES'],
    mfaRequired: true,
    registeredAt: '2025-10-15T00:00:00Z',
    goLiveAt: null,
    wellKnown: null,
  }],
  ['frontier-business', {
    id: 'frontier-business',
    name: 'Frontier Business Banking',
    status: 'not_registered',
    baseUrl: FRONTIER_URL,
    fdxVersion: '6.0',
    capabilities: [],
    registeredAt: null,
    goLiveAt: null,
    wellKnown: null,
  }],
]);

// SSE clients
const sseClients = new Set();

function broadcastEvent(event) {
  const data = JSON.stringify(event);
  log.debug(`SSE → broadcasting to ${sseClients.size} clients: ${event.type} ${event.institutionId}`);
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'open-banking-registry', timestamp: new Date().toISOString() });
});

// List all institutions
app.get('/registry/institutions', (req, res) => {
  const all = Array.from(institutions.values());
  log.debug(`Registry ← list institutions → ${all.length} total`);
  res.json({
    institutions: all,
    total: institutions.size,
  });
});

// Get single institution
app.get('/registry/institutions/:id', (req, res) => {
  const inst = institutions.get(req.params.id);
  if (!inst) {
    log.debug(`Registry ← get ${req.params.id} → not found`);
    return res.status(404).json({ error: 'Institution not found' });
  }
  log.debug(`Registry ← get ${req.params.id} → status=${inst.status}`);
  res.json(inst);
});

// Register an institution (not_registered → pending)
app.post('/registry/institutions/:id/register', (req, res) => {
  const inst = institutions.get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Institution not found' });
  if (inst.status !== 'not_registered') {
    log.warn(`Registry ← register ${req.params.id} rejected: current status=${inst.status}`);
    return res.status(400).json({ error: `Cannot register: current status is ${inst.status}` });
  }

  inst.status = 'pending';
  inst.registeredAt = new Date().toISOString();
  if (req.body.capabilities) inst.capabilities = req.body.capabilities;

  const event = { type: 'status_change', institutionId: inst.id, oldStatus: 'not_registered', newStatus: 'pending', timestamp: inst.registeredAt };
  broadcastEvent(event);

  log.info(`Registry → registered ${inst.id}: not_registered → pending`);
  res.json({ status: 'registered', institution: inst });
});

// Go-live an institution (pending → live)
app.post('/registry/institutions/:id/go-live', async (req, res) => {
  const inst = institutions.get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Institution not found' });
  if (inst.status !== 'pending') {
    log.warn(`Registry ← go-live ${req.params.id} rejected: current status=${inst.status}`);
    return res.status(400).json({ error: `Cannot go live: current status is ${inst.status}` });
  }

  // Try to fetch .well-known
  try {
    const wkUrl = `${inst.baseUrl}/.well-known/fdx-configuration`;
    log.debug(`Registry → fetching .well-known from ${wkUrl}`);
    const wkRes = await fetch(wkUrl);
    if (wkRes.ok) {
      inst.wellKnown = await wkRes.json();
      log.debug(`Registry ← .well-known fetched for ${inst.id}: version=${inst.wellKnown.fdx_version}`);
    } else {
      log.warn(`Registry ← .well-known fetch failed for ${inst.id}: status=${wkRes.status}`);
    }
  } catch (err) {
    log.warn(`Registry ← .well-known fetch error for ${inst.id}: ${err.message}`);
  }

  inst.status = 'live';
  inst.goLiveAt = new Date().toISOString();

  const event = { type: 'status_change', institutionId: inst.id, oldStatus: 'pending', newStatus: 'live', timestamp: inst.goLiveAt };
  broadcastEvent(event);

  log.info(`Registry → go-live ${inst.id}: pending → live`);
  res.json({ status: 'live', institution: inst });
});

// SSE endpoint for real-time events
app.get('/registry/events', (req, res) => {
  log.debug(`SSE → new client connected (total=${sseClients.size + 1})`);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
    log.debug(`SSE → client disconnected (total=${sseClients.size})`);
  });
});

function start() {
  return new Promise(resolve => {
    const server = app.listen(PORT, () => {
      log.info(`Open Banking Registry listening on port ${PORT}`);
      log.info(`Institutions: ${Array.from(institutions.values()).map(i => `${i.id}=${i.status}`).join(', ')}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, institutions, sseClients };
