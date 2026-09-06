# New Engineer Onboarding — Platform Team

Welcome. This guide gets you from a fresh laptop to your first shipped
change in about a week. If anything here is out of date, fix it in the
same PR as your first change.

## Day 1 — access

1. Accept your Okta invite; enable a hardware key (YubiKey issued by
   IT) or Authenticator app.
2. Clone the platform monorepo: `git clone git@github.com:acme/platform`.
   You'll get an SSH key error until IT registers your public key —
   file a ticket in `#it-help`.
3. Install the `acme` CLI: `brew install acme/tap/acme` (Homebrew) or
   `curl -sSL https://get.acme.example | bash` on Linux.
4. Run `acme doctor` — it will list every missing tool with the install
   command for your OS.

## Day 2 — local environment

- **Docker Desktop** or **OrbStack** (recommended on Apple silicon —
  ~40% faster on our workload).
- **Python 3.11.9** via `pyenv`. 3.12 breaks two internal libs we
  haven't upgraded.
- **Postgres 16** and **Redis 7** via `docker compose up` in
  `infra/local`.

Run `make bootstrap` from the monorepo root. It's idempotent and takes
about 12 minutes on a fresh MacBook Pro M3.

## Day 3-4 — your starter task

Every new engineer takes a starter task from the `good-first-issue`
label. It's small (~1 day of work) and its purpose is to exercise the
whole toolchain: clone → branch → change → test → PR → review → deploy
to staging → verify.

Your onboarding buddy is your first reviewer. Ping them in
`#platform-onboarding`; they've promised a turnaround under 4 hours
during business hours.

## Day 5 — deploy

Deploys go through `#ops-deploys`. You'll shadow one deploy before
running your own. The rule is: never deploy alone during your first
two weeks. After that, you own your deploys.

## Ongoing

- Standup is 09:30 local time, video optional.
- Deep-work hours are Tue/Thu 13:00-16:00 — no meetings, and Slack
  responses can wait.
- On-call rotation begins after 6 weeks. You'll shadow one full week
  before your first primary shift.

## Where to ask questions

| Channel               | For                                        |
|-----------------------|--------------------------------------------|
| `#platform-help`      | Anything about the codebase                |
| `#it-help`            | Laptop, VPN, SSO                           |
| `#platform-onboarding`| Explicitly for new hires — no dumb questions |
| `#deploys`            | Deploy status / rollbacks                  |

## Do not

- Push to `main`. It's protected; a PR is the only way in.
- Use production credentials for local development. There is a full
  local dataset seed in `infra/local/seed.sql`.
- Delete a branch someone else is reviewing without asking.
