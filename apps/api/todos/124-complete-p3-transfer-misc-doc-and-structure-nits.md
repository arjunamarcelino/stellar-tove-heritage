---
status: complete
priority: p3
issue_id: 124
tags: [code-review, quality, documentation, relayer]
dependencies: []
---

# Transfer misc nits: authenticatorData MinLength comment, webauthn-agnostic wording, submitSignedTransfer SRP, unused ed25519 knob

## Problem Statement
Four small documentation/structure nits around the passkey-signed transfer path. Each is cosmetic or a
judgment-call cleanup — the security behavior is correct; these tighten comments, wording, structure,
and one YAGNI config knob.

## Findings
1. **Inaccurate MinLength comment.** `submit-transfer.dto.ts` (~line 20) comments
   `@MinLength(48) // >= 37 raw bytes`, but base64url of 37 bytes is 50 chars; 48 chars ≈ 36 bytes. The
   authoritative `< 37` check lives in `passkey-authorization.ts` (defense-in-depth holds), so the DTO
   cap's real job is abuse-bounding, not the exact raw-byte floor. Fix the comment or rely solely on
   the verifier check.
2. **"webauthn-agnostic" wording is inaccurate.** The "relayer stays webauthn-agnostic" wording in
   `cose.helper.ts` (~line 9), `passkey.helpers.ts` (~line 4), and CLAUDE.md is wrong —
   `passkey-authorization.ts` (in `relayer/`) does hand-rolled WebAuthn assertion parsing
   (authenticatorData flags/rpIdHash, clientDataJSON type/origin/crossOrigin). Reword to: "the relayer
   owns raw WebAuthn ASSERTION verification (manual, dependency-free) but does not depend on
   @simplewebauthn; COSE credential decoding stays in wallets."
3. **`submitSignedTransfer` is long.** `soroban-relayer.service.ts` (~lines 257-336) runs
   verify → expiry → encode → re-simulate → fee-cap → locked-send → poll. Optionally extract the
   "attach AuthPayload + re-simulate + fee-cap → prepared tx" block into a private
   `prepareSignedTransfer()`. Keep the security ordering visible — do NOT fragment the ordered gates.
4. **Unused ed25519 knob (YAGNI).** `relayer.config.ts` `ed25519VerifierAddress` /
   `RELAYER_ED25519_VERIFIER_ADDRESS` (~lines 21-22) is a genuine unused knob ("stored now, unused for
   MVP" — future recovery signer). Could be dropped until the recovery-signer feature lands (optional,
   one line, `.optional()`).

## Proposed Solutions
- Fix the MinLength comment (or drop the DTO floor in favor of the verifier check).
- Reword the "webauthn-agnostic" claim across the three sites.
- Optionally extract `prepareSignedTransfer()` without fragmenting the ordered security gates.
- Record a decision on the ed25519 knob (drop until recovery-signer lands, or keep + document).
- **Effort:** Small each · **Risk:** Low

## Recommended Action
**Resolved.** (1) The `authenticatorData` `@MinLength(48)` comment now says it is abuse-bounding only
(~36B) and points at the authoritative `>= 37 raw bytes` check in the verifier. (2) The
"webauthn-agnostic" wording in `cose.helper.ts` + `passkey.helpers.ts` is reworded to "the relayer does
not depend on `@simplewebauthn` but owns raw WebAuthn *assertion* verification manually; COSE
*credential* decoding stays in wallets." (3) The `prepareSignedTransfer()` extraction was **deferred** —
`submitSignedTransfer`'s value is its visibly-ordered security gates (verify → expiry → encode →
re-simulate → fee-cap → locked-send → poll); the review itself flagged "do NOT fragment the ordered
gates," so it stays inline. (4) `ed25519VerifierAddress` is **kept** — it's a documented forward-looking
config for the recovery signer ("stored now, unused for MVP"); dropping/re-adding it later is churn.

## Technical Details
- Files: `src/modules/wallets/transfer/dto/submit-transfer.dto.ts` (~line 20),
  `src/modules/wallets/cose.helper.ts` (~line 9), `src/modules/auth/passkey.helpers.ts` (~line 4),
  `src/modules/relayer/soroban-relayer.service.ts` (`submitSignedTransfer` ~257-336),
  `src/config/relayer.config.ts` (`ed25519VerifierAddress` ~lines 21-22).
- The authoritative raw-byte floor is the `< 37` check in `passkey-authorization.ts`.

## Acceptance Criteria
- [x] MinLength comment is accurate (abuse-bounding; verifier owns the `>= 37` floor).
- [x] The "webauthn-agnostic" wording is corrected (cose.helper + passkey.helpers; the phrase no longer
      appears in src).
- [x] `prepareSignedTransfer()` extraction explicitly deferred (ordered gates kept inline).
- [x] The ed25519 knob decision recorded (kept as a documented future recovery signer).

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: MinLength comment + webauthn-agnostic reword; extraction + ed25519 documented as
  deferred/kept. Build + lint green.
