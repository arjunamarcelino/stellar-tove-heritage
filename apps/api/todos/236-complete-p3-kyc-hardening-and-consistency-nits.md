---
status: complete
priority: p3
issue_id: 236
tags: [code-review, hardening, consistency, TOV-235, PR-33]
dependencies: []
---

# KYC allowlist hardening + consistency nits (bundle)

## Problem Statement
Low-severity hardening and consistency items surfaced across the PR #33 review. None are defects in the current call graph; grouped as defense-in-depth / clarity.

## Findings
1. **`error_reason` slice can split a surrogate pair.** `sanitizeReason` does `.slice(0, 500)` on UTF-16 code units (`backoffice-kyc-allowlist.service.ts:~257`). For astral/emoji/garbage error text a lone surrogate can reach the `varchar(500)` column and error (`22021`), poisoning the whole batch txn. Fix: strip unpaired surrogates / non-BMP + control chars before slicing.
2. **`noop` items don't seed the mirror — undocumented asymmetry.** `persist()` upserts `kyc_allowlist_state` only for `confirmed`, though a `noop` means the read already observed the desired state. Not a bug (mirror advances on mutations only; reads are authoritative), but add a one-line comment so it doesn't read as an oversight. (`backoffice-kyc-allowlist.service.ts:~204`.)
3. **No CHECK that non-submitted results carry a null tx_hash.** `CHK_kae_confirmed_has_hash` enforces `confirmed ⇒ tx_hash`; there's no converse (`noop`/`deferred`/`failed` ⇒ tx_hash IS NULL, and `pending` may also carry one). Code is correct today; add `CHECK (result IN ('confirmed','pending') OR tx_hash IS NULL)` for at-rest invariant rigor. (migration `1716000000029`.)
4. **Boot-probe crash-loops the whole app on a transient RPC blip.** `onApplicationBootstrap` throws on any `getAccount` failure within 5s, taking down the backoffice + public API for a flaky testnet timeout (not just a misconfig). Confirm the fail-fast blast radius is acceptable vs log-and-degrade-this-route. (`soroban-kyc-allowlist.service.ts:48-59`.) Matches the fraction precedent.
5. **Redundant `reason.toLowerCase()` in the fingerprint.** The DTO already constrains `reason` to `^[a-z0-9_]{1,64}$` (lowercase-only), so the fingerprint's `.toLowerCase()` (`:~250`) can never change the value. Drop it or comment it as belt-and-suspenders.
6. **`char(56)` vs `varchar` for StrKey columns.** `wallet`/`last_tx_hash` use `char(56)`/`char(64)`; confirm this matches how other address/StrKey columns are typed elsewhere (e.g. `fraction_contracts` uses `char(56)`/`char(64)` — consistent). Note only.
7. **`fraction_kyc_allowlist` naming proximity.** Three `kyc.*allowlist` tables across two bounded contexts (export vs on-chain admin). Documented in the migration header; optionally add a reverse cross-ref note in `src/modules/wallets/export/`.

## Proposed Solutions
- Address #1 + #3 as cheap defense-in-depth; #2 + #5 as one-line clarity fixes; #4 as a confirmed decision; #6 + #7 are notes only. Effort: Small each.

## Recommended Action
**RESOLVED.**
1. `sanitizeReason` now strips surrogate code units before the slice (no invalid-UTF-8 from a split pair).
2. Added a comment on the noop/mirror asymmetry (mirror advances on mutations only; read is authoritative).
3. Added `CHK_kae_hash_only_when_submitted` (`result IN ('confirmed','pending') OR tx_hash IS NULL`) to the migration; integration test added.
4. Boot-probe fail-fast documented as intentional (disable via `KYC_ALLOWLIST_BOOT_PROBE=false`).
5. `reason.toLowerCase()` in the fingerprint documented as intentional belt-and-suspenders.
6/7. `char(56)` StrKey columns match the `fraction_contracts` precedent, and the `fraction_kyc_allowlist` name distinction is already documented in the migration header — notes only, no change.

## Technical Details
- Affected: `backoffice-kyc-allowlist.service.ts`, `soroban-kyc-allowlist.service.ts`, migration `1716000000029`.

## Acceptance Criteria
- [x] `error_reason` sanitization is surrogate-safe.
- [x] noop/mirror asymmetry + reason.toLowerCase() documented.
- [x] Boot-probe fail-fast documented as intentional + how to disable.

## Work Log
- 2026-07-18: created from PR #33 review (data-integrity, kieran, security, pattern).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- 2026-07-18: RESOLVED — surrogate-safe sanitize, new CHECK + test, and doc comments; all green.
