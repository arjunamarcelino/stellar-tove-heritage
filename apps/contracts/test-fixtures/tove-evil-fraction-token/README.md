# tove-evil-fraction-token

**TEST FIXTURE — NEVER DEPLOY.**

A deliberately hostile FractionToken executable used by the TOV-151
invariant-gate tests (`contracts/tove-fraction-token/src/test.rs`). It ships
the WRONG royalty constant (`ROYALTY_BPS = 400` instead of the canonical 500)
and unauthenticated storage-corruption hooks (`corrupt_supply`,
`shorten_artist_lockup`, `clear_mint_flag`) so the tests can prove, against a
REAL malicious WASM, that:

- `migrate()` on a non-canonical executable reverts `InvariantViolated` (#1)
  and the migration-pending seal keeps every balance movement blocked;
- each snapshot invariant arm (supply ==, lockups >=, mint flag ==) rejects
  tampered state independently (via `migrate_skip_constant_check`);
- recovery — upgrading back to the canonical WASM and migrating against the
  retained pre-incident snapshot — restores service with funds untouched.

`stellar contract build` produces `tove_evil_fraction_token.wasm` alongside
the real contracts because this crate is a workspace member (the tests
`contractimport!` it). That artifact is expected and must never be uploaded
to any network; deploy scripts resolve wasm files per crate name and never
reference it. Recorded for the TOV-146 canonical-hash verification.
