# Financial OS: Production Considerations

These are architectural concerns that sit beneath the core system design. They represent the gap between a working demo and a production system handling real money for millions of users. Each is structurally present in the MVP (defined in the architecture, visible in the design) even if not fully implemented.

For a comprehensive deep-dive on each topic, see [Production at Scale](financial-os-production-at-scale.md).

---

## What's Implemented in the MVP

| Concern | MVP Implementation | Production Evolution |
|---|---|---|
| **Guardrails** | Regex-based inbound/outbound validation on all 4 LLM entry points. Prompt injection detection, off-topic rejection, compliance flagging. `SYSTEM_GUARDRAIL` on all 9 LLM prompts. | Fine-tuned classifier (BERT/DistilBERT), context-aware using twin state, extract to separate service |
| **Human-in-the-Loop** | DAG approval lifecycle (draft → approve → execute). Transfer nodes never auto-execute. Granular per-node approval. | Advisor-in-the-loop for managed accounts, approval expiry for stale plans |
| **PII Filter Multi-Tenancy** | Complete session isolation by design. UUID-keyed sessions, explicit deletion in `finally` blocks, TTL expiry. | Redis-backed session store for horizontal scaling, secondary NER verification pass |
| **Idempotency** | Transactions use ON CONFLICT DO NOTHING. Template discovery checks cache before LLM call. Connection creation checks for active connections. | Client-generated idempotency keys on all DAG/council requests |
| **Event Sourcing** | Append-only transaction and metric stores, SCD2 account versioning, onboarding event log. | Full event-sourced session log with replay capability |
| **Eventual Consistency** | Each data source carries freshness timestamps. Background polling with configurable intervals. | Per-institution webhook integration to reduce polling volume |
| **Consent Handling** | Per-account OAuth consent enforced at every FDX endpoint. Consent revocation detected on next poll (403), connection marked revoked. | Layered consent model (connection, advisory, benchmark), consent dashboard |
| **Anomaly Detection** | 20% balance change threshold with alert generation. Consent revocation handling. Exponential backoff on failures. | ML-based anomaly detection, fraud pattern recognition, proactive alerts |
| **Session Persistence** | pgvector embeddings (1536d, HNSW index) for council sessions and goals. Soft archive pattern. | HNSW index tuning at scale, partition by user_id, archival to cold storage |
| **Authentication** | JWT access/refresh tokens, bcrypt password hashing, role-based access control, user isolation. | Token encryption at rest via KMS, PKCE on all OAuth flows, audit logging |

## What Needs Building for Production

| Concern | Why It Matters | See |
|---|---|---|
| **Sagas & Compensating Transactions** | DAG nodes spanning multiple systems need paired undo actions for failure recovery | [Production at Scale](financial-os-production-at-scale.md) |
| **Rate Limiting & Backpressure** | Millions of users × 3-5 institutions = tens of millions of API calls daily | [Production at Scale](financial-os-production-at-scale.md) |
| **Template Versioning** | Banks update FDX APIs — stale templates need graceful migration without breaking connections | [Production at Scale](financial-os-production-at-scale.md) |
| **Audit & Explainability** | Regulators need exact reconstruction of what the system said, what data it had, and why | [Production at Scale](financial-os-production-at-scale.md) |
| **LLM Provider Degradation** | Graceful fallback when 1, 2, or all 3 providers are down | [Production at Scale](financial-os-production-at-scale.md) |
| **Cost Management** | 100K+ LLM calls/day at scale requires query tiering, caching, and model tiering | [Production at Scale](financial-os-production-at-scale.md) |
| **Data Sovereignty** | Canadian financial data under Canadian regulations, all infrastructure in ca-central-1 | [Production at Scale](financial-os-production-at-scale.md) |
| **Right to Be Forgotten** | PIPEDA-compliant comprehensive deletion cascade across all 16 tables | [Production at Scale](financial-os-production-at-scale.md) |
| **Goal System Scaling** | Background reassessment of millions of goals requires prioritization and batching | [Production at Scale](financial-os-production-at-scale.md) |
| **pgvector Scaling** | HNSW index tuning, embedding cost management, partition strategies | [Production at Scale](financial-os-production-at-scale.md) |
