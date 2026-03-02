# Financial OS: Production Considerations

These are architectural concerns that sit beneath the core system design. They represent the gap between a working demo and a production system handling real money for millions of users. Each should be structurally present in the MVP (defined in the architecture, visible in the design) even if not fully implemented.

---

## Sagas & Compensating Transactions

When an Action DAG spans multiple systems (Wealthsimple internal + external banks via FDX), there's no single database transaction that can roll everything back if something fails halfway. A saga manages this by pairing each step with a compensating transaction — a defined "undo" action. If Node 4 fails after Nodes 1-3 succeeded, the DAG engine knows how to walk backward and reverse the completed steps. Each DAG node carries its forward action, its compensating action, and whether compensation is automatic, manual, or requires approval. This maps naturally onto the existing autonomy spectrum.

## Idempotency

If a transfer request times out, did it go through or not? Every action in the DAG needs an idempotency key so that retrying a step doesn't accidentally execute it twice. Critical for anything involving money movement.

## Event Sourcing

Rather than storing just the current state of the twin, store every event that changed it — every transaction pulled, every balance update, every connection made. The current state is derived from the event log. This gives full audit history, the ability to replay and debug, and a compliance story regulators will love.

## Rate Limiting & Backpressure

When you have 3 million users each connected to 3-5 institutions, the polling infrastructure is generating tens of millions of API calls daily. The system needs to respect each institution's rate limits, spread polling across time windows, and gracefully degrade when an institution is under load. The orchestrator manages this as a shared resource, not per-user.

## Eventual Consistency

The twin is never perfectly real-time. There's always a lag between what happened at the bank and what the twin shows. The system communicates this honestly — "Maple Direct data as of 2:00 AM today" — and handles cases where the user knows something the twin doesn't yet (e.g., they just made a transfer that hasn't been polled yet).

## Consent Drift

A user might revoke consent at the bank's own dashboard without telling Wealthsimple. The system discovers this on the next poll (401 unauthorized). It handles this gracefully — updates the twin to reflect reduced visibility, informs the user, doesn't crash.

## PII Filter Multi-Tenancy

If two users ask similar questions in parallel, the filter needs completely isolated session mappings. No risk of cross-contamination where User A's real values leak into User B's perturbed context.

## Institution Template Versioning

Banks will update their FDX APIs over time — new endpoints, changed schemas, deprecated fields. The orchestrator detects when a cached template is stale (usually via a failed poll or unexpected response) and triggers re-discovery. Template versioning with graceful migration rather than hard breaks.
