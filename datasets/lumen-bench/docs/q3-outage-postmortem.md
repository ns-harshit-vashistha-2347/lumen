# Postmortem — Q3 checkout outage (INC-2025-0714)

**Severity:** Sev-1 (customer-visible for 47 minutes)
**Author:** Priya Menon, on-call platform
**Approvers:** Ravi Deshmukh (SRE), Nadia Rios (Privacy — no user data was exposed)

## TL;DR

At 14:12 UTC on 2025-07-14 a routine deploy of the `checkout` service
began failing every 3rd request. Root cause was a Postgres migration
that added a `NOT NULL` column without a default; the deploy pipeline
did not surface the failure because the migration was applied via a
sidecar container whose exit code was masked. Full recovery at 14:59.

## Timeline (all UTC)

| Time  | Event                                                          |
|-------|----------------------------------------------------------------|
| 14:11 | Deploy of `checkout@v2.144` begins                             |
| 14:12 | Migration container exits with code 1; sidecar wrapper reports 0 |
| 14:13 | First failing `/purchase` returns 500                          |
| 14:15 | Error rate crosses 5%; PagerDuty alerts on-call                |
| 14:17 | Priya joins; suspects new checkout deploy                      |
| 14:22 | Rollback to `v2.143` triggered                                 |
| 14:31 | Rollback stuck — new pods can't pass health check              |
| 14:36 | Ravi joins; identifies the added column                        |
| 14:44 | Manual `ALTER TABLE ... DROP COLUMN` executed                  |
| 14:48 | Rollback pods pass health check                                |
| 14:52 | Error rate returns to baseline                                 |
| 14:59 | Fully re-verified; incident resolved                           |

## Impact

- **11,240 failed `/purchase` requests** across 2,890 unique customers.
- No orders were double-charged; the payment provider was idempotent
  on our behalf.
- No customer data was written, read, or exposed outside of Acme's VPC.
- SLA breach: monthly checkout availability dropped from 99.97% to
  99.89%. Refunds triggered under contracts with 5 enterprise
  customers, totalling **$14,300**.

## Contributing factors

1. **Silent migration failures.** The `db-migrate` sidecar wrapped
   `alembic upgrade head` in a subshell whose exit code was discarded.
   The pipeline reported "migration ok" regardless of what happened.
2. **No pre-deploy schema check.** Nothing in CI would have caught the
   missing default on a NOT NULL column against a live table with rows.
3. **Rollback dependency on schema.** The prior version expected the
   *pre-migration* schema, so rollback couldn't succeed until the
   column was manually removed.

## Action items

| # | Action                                                     | Owner   | Due        |
|---|------------------------------------------------------------|---------|------------|
| 1 | Fix `db-migrate` sidecar to propagate the real exit code   | Ravi    | 2025-07-25 |
| 2 | Add `alembic check` gate to the pre-deploy pipeline        | Priya   | 2025-08-01 |
| 3 | Publish "expand-then-contract" migration playbook          | Ravi    | 2025-08-15 |
| 4 | Backfill defaults for the 3 other columns with the same shape | Nadia | 2025-08-30 |
| 5 | Add integration test for rollback across a schema change   | Priya   | 2025-09-15 |

## What went well

- The alert fired within 4 minutes of the first user-facing error.
- The team decision to roll back at 14:22 was correct given the signal
  we had; the fact that rollback was slow is a *separate* problem from
  the decision to attempt it.

## What went badly

- Nobody looked at the migration container's real exit code because
  our runbook didn't mention it.
- The `checkout` service has no read-only feature-flagged mode we
  could have enabled to preserve read paths while writes were failing.

## Lessons

Silent failure paths are worse than loud ones. A green CI check that
lies is more dangerous than a red one that tells the truth. Every
sidecar in the deploy pipeline is being audited for the same class of
bug over the next two weeks.
