---
status: complete
priority: p3
issue_id: 333
tags: [code-review, quality, tov-160]
dependencies: []
---
# `previewClearing` access-audit: comment says "Non-fatal" but it throws, and a per-access audit on a dry-run read may be YAGNI

## Problem Statement
`previewClearing` (the read-only clearing dry-run) records an `OFFERING_CLEARING_PREVIEWED` access-audit with an inline comment reading "Non-fatal." — but the call is `await this.audit.record(...)` with NO try/catch and NO manager, so if the audit write fails it THROWS and fails the entire preview. The comment and the behavior are contradictory. Separately, there is a YAGNI question: unlike the TOV-241 KYC read audit (which is fail-closed and compliance-mandated), a dry-run PREVIEW is not a state change, so a per-access audit on a read is unusual unless an AC/FR explicitly requires an access trail for the sealed book.

## Findings
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:360-368` — the `await this.audit.record({ ... kind: OFFERING_CLEARING_PREVIEWED ... })` with the "Non-fatal." comment, no try/catch, no manager (so a failure propagates and 500s the preview).
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:338-343` — the method doc: "GATED to a closed bidding window ... per-collector identity is redacted; every access is audited" (states auditing as intended behavior).
- Precedent for contrast: the TOV-241 KYC read audit is deliberately fail-closed + compliance-mandated (see `kyc-allowlist/` — `kyc.allowlist.read`, fail-closed per read); a preview dry-run has no equivalent stated mandate.

## Proposed Solutions
### Option A — Align the comment to the behavior (fail-closed) if the audit trail is required
- Description: If an access trail for the sealed-book preview is an AC/FR requirement, keep the throwing `await` and change the comment from "Non-fatal." to state it fails closed (no preview without a durable audit — arguably correct for a sensitive sealed-book read).
- Pros: Comment matches behavior; the sensitive-read access trail is guaranteed; consistent with the TOV-241 fail-closed read-audit precedent.
- Cons: An audit-store blip makes the preview unavailable.
- Effort: Small
- Risk: Low

### Option B — Make it genuinely non-fatal
- Description: If non-fatal was the intent, wrap the record in `.catch()` (log-and-continue) so an audit failure never fails the preview.
- Pros: Comment matches behavior; preview stays available under audit-store trouble.
- Cons: An access can then occur without a durable audit row (weakens the trail).
- Effort: Small
- Risk: Low

### Option C — Drop the preview access-audit entirely (YAGNI)
- Description: If FR-05.05 does not require an access trail for the preview, remove the `OFFERING_CLEARING_PREVIEWED` write (and the audit kind) — a dry-run read is not a state change.
- Pros: Removes an unusual per-read audit + its audit-kind; simpler.
- Cons: Loses the who-previewed-which-sealed-book trail; wrong if a compliance/AC requirement exists.
- Effort: Small
- Risk: Low

## Recommended Action
First confirm against FR-05.05 whether an access trail for the sealed-book preview is required. If required → Option A (keep fail-closed, fix the misleading "Non-fatal." comment to say so). If NOT required → Option C (drop the `OFFERING_CLEARING_PREVIEWED` write + audit kind as YAGNI). Do not leave the current state where the comment claims non-fatal but the code fails closed.

## Technical Details
The audit call passes no `manager`, so it is not transactional with anything (the preview writes nothing) — the only question is fatal-vs-non-fatal on the audit write itself. The sealed-book front-running rationale (window-closed gate at `:349-355`) is why an access trail might be wanted; weigh that against the TOV-241 precedent that reserves fail-closed read-audits for compliance-mandated reads.

## Acceptance Criteria
- The audit-record behavior and its inline comment agree (either fail-closed-and-say-so, or non-fatal-via-`.catch()`), OR the preview access-audit is removed.
- The chosen behavior is justified against FR-05.05 (access trail required vs not) in the work log.

## Work Log
- 2026-08-20: created from PR #43 security-sentinel + code-simplicity-reviewer review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Made the `OFFERING_CLEARING_PREVIEWED` access-audit BEST-EFFORT (`.catch(warn)`) and corrected the comment to
match — previously the un-caught `await` was fail-closed while the comment said "Non-fatal." A preview is a
read (dry-run), so a transient audit-write blip must not fail the admin's request. Kept the audit itself (the
access trail on a sealed-book review is a cheap, useful control for the highest-stakes money surface; unlike
the compliance-mandated KYC read audit it need not be fail-closed). Build + settle service spec green.
