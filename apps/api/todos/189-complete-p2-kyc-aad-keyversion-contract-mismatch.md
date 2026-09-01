---
status: complete
priority: p2
issue_id: 189
tags: [code-review, security, crypto, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17) — Option A
Bound the DEK-wrap AAD to the key version so code now matches the `IKeyWrapper` contract.
`ConfigKeyWrapper.wrapDek`/`unwrapDek` now set the GCM AAD to `${rowAad}|${keyVersion}` via a private
`boundAad(aad, keyVersion)` helper (`src/modules/kyc/crypto/config-key-wrapper.ts`) — `wrapDek` uses its
own `keyVersion`, `unwrapDek` uses `wrappedDek.keyVersion`. The blob AAD stays the 3-field row binding.
Added a crypto unit test proving a DEK wrapped at v1 cannot be unwrapped at v2 (SEC-C1 rotation safety);
all 10 crypto unit tests + build + lint green. No production data exists yet, so the wrap-format change
is safe.

# KYC DEK-wrap AAD omits keyVersion — code contradicts the interface contract (rotation-safety gap)

## Problem Statement
The `IKeyWrapper` contract documents the DEK-wrap AAD as binding `userId|submissionId|docType|keyVersion`
(the SEC-C1 rotation guarantee), but the service actually feeds a **3-field** AAD
(`userId|submissionId|docType`) to both the blob cipher and the DEK wrap. `keyVersion` is not in the
bound data. No exploit today (single key version), but the cryptographic version-binding the contract
promises does not exist, so a future multi-KEK rotation loses the intended safety net.

## Findings
- `src/modules/kyc/crypto/key-wrapper.interface.ts:13-14` — doc: AAD binds `userId|submissionId|docType|keyVersion`.
- `src/modules/kyc/kyc.service.ts:122` — builds `aad = ${userId}|${submissionId}|${docType}` (3 fields), passed to `encryptDocument` which uses the same AAD for both the blob and `wrapDek`.
- Today the only version guard is `keyVersion !== this.keyVersion` throwing in `src/modules/kyc/crypto/config-key-wrapper.ts:53` — correct for MVP, but not the cryptographic binding the contract states.

## Proposed Solutions
### Option A (recommended): bind keyVersion into the wrap AAD
- Have `wrapDek`/`unwrapDek` append `|${keyVersion}` to the AAD they use (the wrapper knows its version at wrap time; at unwrap time reconstruct from `wrappedDek.keyVersion`). Keep the blob AAD 3-field or align both — decide and document. **Pros:** delivers the promised rotation binding. **Cons:** changes the wrap AAD ⇒ any already-written rows (none in prod yet) would need the new AAD; do before real data exists. **Effort: Small.**

### Option B: correct the contract to match the code
- Update `key-wrapper.interface.ts` + `kyc-crypto.service.ts` docstrings to state the 3-field AAD and drop the `|keyVersion` claim; rely on the explicit version-mismatch throw for rotation. **Pros:** zero crypto change. **Cons:** weaker guarantee than advertised; must be a conscious decision. **Effort: Small.**

## Recommended Action
_(triage — prefer Option A while there is no production data.)_

## Technical Details
- Affected: `src/modules/kyc/crypto/config-key-wrapper.ts`, `src/modules/kyc/crypto/kyc-crypto.service.ts`, `src/modules/kyc/kyc.service.ts:122`, `src/modules/kyc/crypto/key-wrapper.interface.ts`.
- Add a crypto unit test asserting an unwrap under a different `keyVersion`-AAD fails (once bound).

## Acceptance Criteria
- [ ] Code and `IKeyWrapper` contract agree on the exact AAD fields.
- [ ] If Option A: a wrapped DEK cannot be unwrapped under a different keyVersion's AAD (test proves it).

## Work Log
- 2026-07-17: Filed from PR #30 review (security-sentinel P2-1). No code changed.
