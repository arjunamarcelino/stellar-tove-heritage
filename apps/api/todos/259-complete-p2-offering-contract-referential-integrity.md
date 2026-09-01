---
status: complete
priority: p2
issue_id: 259
tags: [code-review, data-integrity, migration, TOV-152, PR-36]
dependencies: []
---

# Offering↔contract linkage & soft-delete safety are service-enforced, not schema-enforced

## Problem Statement
The `offerings` schema has two independent FKs (`artwork_id → artworks`, `fraction_contract_id → fraction_contracts`) but nothing guarantees the referenced contract actually belongs to the referenced artwork, and the migration header's "no soft-delete trigger needed" claim rests on invariants only the service upholds. Via the endpoint this can't happen (the service resolves the contract from the artwork), but for a money-adjacent table the schema itself provides no defense-in-depth against a direct/erroneous write.

## Findings
Flagged by **data-integrity-guardian (2× P2)**. The endpoint path is safe (`findActiveByArtworkId(artwork_id)` always returns the SAME artwork's active, deployed contract), so this is a defense-in-depth gap, not an endpoint bug.
1. **Cross-artwork contract reference unenforced** — `src/database/migrations/1716000000032-CreateOfferingsTable.ts` FK block. Two separate single-column FKs; an offering on artwork A can legally reference artwork B's contract. The header comment claims provenance is "pinned to the exact source contract" but the artwork↔contract linkage that implies is not enforced.
2. **Transitive soft-delete safety has holes** — migration header lines ~10-16. The "no trigger needed" argument assumes (a) an active offering always references a `deployed` contract, and (b) that contract belongs to the offering's artwork. Neither is schema-enforced: the schema permits referencing a `deploying`/`failed` contract, and a `failed` contract is NOT covered by 028's `CHK_fc_deployed_not_softdeleted`, so it can be soft-deleted and orphan the offering. Combined with (1), 028's `trg_block_artwork_softdelete_with_live_fc` protects the *contract's* artwork, not necessarily the *offering's* artwork.

## Proposed Solutions
1. **Composite FK** `(artwork_id, fraction_contract_id) → fraction_contracts(artwork_id, id)` (requires adding `UNIQUE(artwork_id, id)` on `fraction_contracts`). Forces the referenced contract to belong to the referenced artwork. Effort: Medium (touches the 028 table). Risk: low, but a cross-migration change.
2. **Offerings-side soft-delete guard trigger** mirroring 028's `trg_block_artwork_softdelete_with_live_fc`, plus a CHECK/trigger that the referenced contract is `deployed`. Effort: Medium. Closes the orphan window directly.
3. **Accept + document** — keep the service as the sole enforcer, but replace the migration header's "safe because transitive" claim with an explicit "enforced by the service, NOT the schema" caveat so a future dev who relaxes 028 understands the dependency. Effort: Small. Weakest defense but honest.

## Recommended Action
**RESOLVED — Solution 1 (composite FK, hard enforce), confirmed with user.** New migration
`1716000000033-EnforceOfferingContractArtworkLink.ts`: adds `UQ_fc_artwork_id UNIQUE (artwork_id, id)` on
`fraction_contracts`, drops the single-column `FK_offerings_fraction_contract`, and adds the composite
`FK_offerings_artwork_fc (artwork_id, fraction_contract_id) → fraction_contracts(artwork_id, id) ON DELETE
RESTRICT`. The DB now guarantees the referenced contract belongs to the referenced artwork, so migration
032's "transitive soft-delete safety" claim genuinely holds (an active offering references a `deployed`,
same-artwork contract, both un-soft-deletable per 028). The migration's `down()` also uses the fail-closed
`NODE_ENV` guard (see todo 261).

## Technical Details
- `src/database/migrations/1716000000032-CreateOfferingsTable.ts` (FKs + header comment).
- Cross-references migration `1716000000028` (`CHK_fc_deployed_not_softdeleted`, `trg_block_artwork_softdelete_with_live_fc`).
- Related: todo 260 (fraction_contract_id column) — if the FK is kept, option 1/2 strengthen it.

## Acceptance Criteria
- [x] Decision recorded: composite FK (hard enforce), confirmed with user.
- [x] A direct INSERT referencing a mismatched artwork/contract is rejected at the DB layer (integration test `rejects a contract belonging to a DIFFERENT artwork`).
- [x] Migration 033 header documents that the composite FK is what makes the transitive soft-delete safety hold.

## Work Log
- 2026-08-18: created from PR #36 review (data-integrity-guardian, 2× P2).
- 2026-08-18: RESOLVED — migration `1716000000033` (UQ_fc_artwork_id + composite FK_offerings_artwork_fc). Integration test retargeted to the composite FK + new cross-artwork-mismatch case (10→11 tests). `yarn db:test:setup` applied 033; integration 11/11, e2e 9/9, build + lint green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/36
