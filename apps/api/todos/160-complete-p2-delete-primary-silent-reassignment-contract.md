---
status: complete
priority: p2
issue_id: 160
tags: [code-review, api-contract, wallets, tov-25, architecture]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A. `DELETE /me/wallets/:id` now returns **200** with a `DeleteWalletResponseDto`
`{ deletedId, newPrimaryWalletId }` (`me/dto/delete-wallet-response.dto.ts`). `WalletsService.removeWallet`
returns `{ promotedWalletId }` (the auto-promoted sibling, or null when a non-primary wallet was removed);
`MeWalletsService.remove` maps it to the DTO. The FE learns the new settlement wallet directly — no follow-up
`GET /me/wallets` and no race window. Swagger operation summary + the DTO `@ApiProperty` descriptions document
the reassignment. Updated the e2e assertions (non-primary delete → `newPrimaryWalletId: null`; primary delete
→ `newPrimaryWalletId = promoted sibling`) and the unit tests. **FE coordination:** flagged for TOV-42 — the
DELETE response changed from `204` to `200 + body`. Suites green (unit 18, e2e 13); typecheck + lint clean.

# DELETE-of-primary silently reassigns the settlement wallet behind 204

## Problem Statement
`DELETE /api/v1/me/wallets/:id` now auto-promotes the oldest eligible sibling to primary when the deleted
wallet was the primary (`src/modules/wallets/wallets.service.ts:232-251`), but the endpoint returns
`204 No Content`. The **settlement** wallet (where funds route) can therefore change as an invisible side
effect of a delete — the caller has no way to learn *which* wallet is now primary without a follow-up
`GET /me/wallets`. The server-side promotion choice ("oldest eligible byow sibling") is not surfaced.

This is the #1 FE-integration risk for TOV-42: a client that deletes a wallet and assumes the primary is
unchanged (or must be re-chosen) will mis-route settlement. The transactional coupling of unbind+reassign is
correct and must stay; the concern is purely the **API contract's observability**.

## Findings
- `wallets.service.ts:232-251` — primary delete demotes target, promotes oldest sibling, soft-deletes target.
- `me-wallets.controller.ts` — `DELETE :id` returns `204 No Content` (`@HttpCode(HttpStatus.NO_CONTENT)`);
  the Swagger *summary* was updated to mention auto-promote, but the response shape was not.
- `me-wallets.service.ts` `remove()` returns `void`; the `onPrimaryReassigned` callback knows
  `{ previousWalletId, newWalletId }` but discards it after writing the audit row.

## Proposed Solutions
### Option A (recommended): Return the reassignment result from DELETE
- Change DELETE to `200 OK` with a small body when a promotion happened, e.g.
  `{ deletedId, newPrimaryWalletId }` (or the updated `MeWalletDto` of the promoted wallet); keep `204`/empty
  when no promotion occurred (non-primary delete). The `onPrimaryReassigned` payload already carries this.
- **Pros:** the settlement change is observable; FE avoids a follow-up round-trip and a race window.
  **Cons:** changes the DELETE status/shape (coordinate with FE/TOV-42). **Effort: Small.**

### Option B: Keep 204, document the contract explicitly
- Leave the response as-is but document (OpenAPI description + FE integration note) that DELETE-of-primary
  reassigns and the client MUST re-read `GET /me/wallets` afterward.
- **Pros:** zero code change. **Cons:** leaves the change implicit; easy for FE to miss. **Effort: Small.**

## Recommended Action
_(triage — coordinate with TOV-42 FE)_

## Technical Details
- Files: `src/modules/wallets/me/me-wallets.controller.ts`, `me-wallets.service.ts`,
  `src/modules/wallets/wallets.service.ts` (250-251).
- If Option A: update the e2e auto-promote test to assert the returned `newPrimaryWalletId`.

## Acceptance Criteria
- [ ] A DELETE that triggers auto-promotion communicates the new primary to the client (body or documented re-read).
- [ ] OpenAPI/Swagger reflects the actual response shape.
- [ ] FE contract (TOV-42) confirmed.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #27 (architecture reviewer). Matches an FE-contract concern
  raised in-session about the set-primary/delete contract.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/27
- Related FE ticket: TOV-42
