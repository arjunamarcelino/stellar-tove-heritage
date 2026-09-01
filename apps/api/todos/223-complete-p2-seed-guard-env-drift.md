---
status: complete
priority: p2
issue_id: 223
tags: [code-review, migration, security, TOV-233, PR-32]
dependencies: []
---

# Fixture seed guarded by NODE_ENV==='production' string-equality → drift seeds fractionalizable fixtures into non-prod-labelled envs

## Problem Statement
The fixture seed is skipped only when `NODE_ENV` exactly equals `'production'`. Any non-canonical value seeds a fake artist + wallet + immediately-fractionalizable artworks, letting an admin trigger a real on-chain deploy against a bogus artist address in a mislabelled environment.

## Findings
- `src/database/migrations/1716000000027-CreateArtworksTable.ts` ~line 66 `if (process.env.NODE_ENV === 'production') return;`.
- Any non-canonical value (`Production`, `prod`, unset on a staging box) SKIPS the guard and seeds a fake artist + wallet (public key `GDJVU7DR…`, secret not necessarily team-controlled) + 3 artworks (two `verified` = immediately fractionalizable).
- An admin (or leaked admin token) can then trigger a real on-chain deploy against a bogus artist address in any mislabelled env.

## Proposed Solutions
### Option A (recommended): explicit opt-in + non-fractionalizable seed status
- Gate seeds on an explicit opt-in (e.g. `SEED_FIXTURES==='true'`) rather than "not production".
- And/or seed the artworks as a non-fractionalizable status so a stray env cannot deploy against fixtures.
- **Effort:** Small.

## Recommended Action
**RESOLVED (Option A).** The fixture seed is now gated on an EXPLICIT opt-in — `process.env.NODE_ENV === 'production' || process.env.FRACTION_SEED_FIXTURES !== 'true'` short-circuits it — so a `NODE_ENV` value of `Production`/`prod`/unset no longer accidentally seeds a fake, immediately-fractionalizable artist+artworks into a mislabelled non-prod environment. Production never seeds even if the flag is set (defense-in-depth). `CREATE TABLE` still runs everywhere. Documented `FRACTION_SEED_FIXTURES` in `.env.example` (default false); integration/e2e specs self-provision their own artwork rows rather than depending on the migration seed.

## Technical Details
- Affected: `src/database/migrations/1716000000027-CreateArtworksTable.ts` (~line 66).
- Seeded fixtures include a fake artist wallet (`GDJVU7DR…`) whose secret is not necessarily team-controlled, plus two `verified` (immediately fractionalizable) artworks.

## Acceptance Criteria
- [ ] Seeding requires an explicit positive opt-in, not the absence of `'production'`.
- [ ] A mislabelled `NODE_ENV` value cannot silently seed fixtures.
- [ ] Seeded artworks cannot be deployed on-chain without a further explicit step (non-fractionalizable seed status).

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — seed requires FRACTION_SEED_FIXTURES=true and never runs in prod; build green.
