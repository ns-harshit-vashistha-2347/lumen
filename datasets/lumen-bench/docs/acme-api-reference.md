# Acme Ledger API — Developer Reference

**Base URL:** `https://api.acme.example/v2`
**Auth:** Bearer token issued by `/oauth/token`. Tokens are valid for
15 minutes; refresh tokens for 30 days.

## Authentication

Send the access token as an `Authorization: Bearer <token>` header on
every request. Tokens that have been revoked (via `/oauth/revoke`)
return `401` with body `{"error":"token_revoked"}`.

Rate limit: **100 requests per minute per client_id**, plus a burst
allowance of 20. Exceeding the limit returns `429` with a
`Retry-After` header (seconds).

## Endpoints

### `POST /entries`

Create a ledger entry. Body:

| Field       | Type   | Required | Notes                                      |
|-------------|--------|----------|--------------------------------------------|
| `amount`    | int    | yes      | In minor units (cents). Range ±1e12.       |
| `currency`  | string | yes      | ISO 4217 uppercase.                        |
| `memo`      | string | no       | Max 512 chars.                             |
| `posted_at` | string | no       | RFC3339. Defaults to server time.          |
| `idempotency_key` | string | yes | Client-generated UUID. Replays return the first response for 24h. |

Returns `201` with the created entry. Idempotent replays return `200`.

### `GET /entries`

List entries. Query parameters:

- `since` — RFC3339 timestamp, inclusive
- `until` — RFC3339 timestamp, exclusive
- `cursor` — opaque; passed from the previous response's `next_cursor`
- `limit` — default 50, max 200

Cursor-based pagination is stable across writes; offset-based is not
supported.

### `POST /entries/:id/reverse`

Post a compensating entry that zeros out `:id`. Requires the caller's
token to hold the `ledger:write` scope. Returns `409` if `:id` was
itself a reversal.

### `GET /accounts/:id/balance`

Returns the aggregate balance for an account. The response includes an
`as_of` timestamp — balances are eventually consistent up to
approximately **2 seconds**.

## Error codes

| HTTP | `error` field       | When                                     |
|------|---------------------|------------------------------------------|
| 400  | `invalid_request`   | Payload validation failed                |
| 401  | `token_revoked`     | Bearer token has been revoked            |
| 401  | `token_expired`     | Bearer token past its 15-minute lifetime |
| 403  | `insufficient_scope`| Missing a required scope                 |
| 404  | `not_found`         | Resource does not exist for this client  |
| 409  | `conflict`          | Idempotency-key reuse with different body |
| 422  | `unprocessable`     | Semantically invalid (e.g. bad currency) |
| 429  | `rate_limited`      | Rate limit exceeded                      |
| 502  | `upstream_error`    | Downstream ledger core temporarily down  |

## Webhooks

Configure a delivery URL via the dashboard. Events are signed with
HMAC-SHA256 using your webhook secret. The signature is sent in the
`X-Acme-Signature-v1` header; verify against the raw request body.

Retry policy: 6 attempts over 24 hours (30s, 5m, 30m, 2h, 6h, 24h).
Non-2xx responses are retried; anything in the 2xx range is treated as
delivered.

## Deprecation

The v1 API is deprecated and will be removed on **2026-12-31**.
Endpoints in this document (v2) are the current supported surface.
