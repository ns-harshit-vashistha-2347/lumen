# Acme Corp — Data Retention Policy

**Document ID:** POL-DR-004
**Version:** 3.1 (effective 2025-03-01, supersedes v3.0)
**Owner:** Chief Privacy Officer (Nadia Rios)

## 1. Purpose

This policy defines how long Acme retains each class of data and how it
is destroyed at end-of-life. It exists to satisfy regulatory obligations
(GDPR, CCPA, SOX) and to reduce the blast radius of any future incident:
data that no longer exists cannot be leaked.

## 2. Scope

This policy applies to every production system operated by Acme,
including customer-facing applications, internal tooling, backups, and
mirror environments. It does **not** cover:

- Personal devices used for occasional work-from-home. Those are covered
  by the separate BYOD policy (POL-SEC-011).
- Physical paper records at Acme's Zurich office, which are governed by
  Swiss FADP under a separate schedule.

## 3. Retention periods

| Data class                     | Retention | Basis                              |
|--------------------------------|-----------|------------------------------------|
| Financial ledger entries       | 7 years   | SOX §802                           |
| Signed customer contracts      | 10 years  | Statute of limitations for contract disputes |
| Support ticket transcripts     | 3 years   | Product improvement + audit        |
| Application access logs        | 90 days   | Incident forensics                 |
| Network flow logs              | 30 days   | Storage cost vs. investigation need |
| Employee performance reviews   | 5 years post-departure | HR practice           |
| Marketing email open/click     | 13 months | GDPR "reasonable expectation" test |
| Audit-critical event log       | Indefinite | Cannot be deleted, only archived  |
| Anonymized product telemetry   | Indefinite | No personal data after anonymisation |

Any data class not listed above defaults to **90 days** unless the data
owner files an exception (see §6).

## 4. Deletion procedures

When a record hits its retention limit, the owning system MUST:

1. Remove all copies from primary storage within 24 hours of expiry.
2. Purge from every backup snapshot within 90 days (backup rotation
   naturally achieves this for daily snapshots).
3. Log the deletion event to the audit-critical event log with the
   record's synthetic id — not the raw content.

The Chief Privacy Officer runs a quarterly reconciliation report against
sample records; a failure to purge is a Sev-2 incident.

## 5. Roles and responsibilities

- **Data owner** — the team lead responsible for a given system.
  Signs off on retention windows for that system's data classes.
- **Privacy Office** — publishes and audits this policy. Approves
  exceptions.
- **Security Engineering** — provides the tooling used to enact
  retention (the `retention-runner` cron in the platform toolkit).
- **Legal** — pauses retention via a Legal Hold when litigation is
  anticipated.

## 6. Exceptions and legal holds

A data owner may request an exception via the Privacy Office. Approved
exceptions are reviewed annually. A Legal Hold overrides this policy in
full for the affected data set until Legal lifts the hold; no
exceptions to this rule exist.

## 7. What this policy does not cover

This document intentionally does not address:

- **Encryption of data at rest.** See the Data Protection Standard
  (STD-SEC-002).
- **Cross-border transfers.** See the Transfer Impact Assessment
  procedure (PROC-PRIV-007).
- **Right-to-be-forgotten requests.** Those follow the GDPR Article 17
  workflow documented in POL-PRIV-002.

## 8. Change log

| Version | Date       | Change                                            |
|---------|------------|---------------------------------------------------|
| 3.1     | 2025-03-01 | Added Marketing email row; clarified §6           |
| 3.0     | 2024-06-15 | Extended contract retention 7→10y after Legal req |
| 2.4     | 2023-09-01 | Introduced audit-critical event log class         |
