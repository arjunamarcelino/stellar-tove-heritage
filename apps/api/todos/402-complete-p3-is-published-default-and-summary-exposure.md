---
status: complete
priority: p3
issue_id: 402
tags: [code-review, tov-191, pr-51, security, data-integrity]
dependencies: []
---
# `is_published` DEFAULTs true on the expanded tier + un-allowlisted `summary` — latent anonymous exposure for future writers

## Resolution (2026-08-24) — Option A
Flipped `is_published` DB DEFAULT `true → false` in migration `1716000000047` (opt-in publish) and mirrored the entity `@Column` default. No behavior change today: the two default-tier emitters set `is_published=true` explicitly, and all seeds/tests are explicit. A future expanded-tier writer (`admin_note`/`technical`/`attestation`) that omits the flag is now safe-by-default (unpublished → never on `?expand=true`). Re-applied to the test DB and verified `column_default = false`; timeline integration 13/13 + e2e 10/10 green.

**Deferred (documented, not code):** the `summary` stored-XSS / PII surface is a concern only for the future admin-authored `admin_note` writer (server-composed summaries today are safe). Captured as a requirement for that writer's ticket — sanitize/length-limit + output-encode `summary` on write. Not actionable in this PR (no admin_note writer exists).
- Files: `src/database/migrations/1716000000047-CreateArtworkTimelineEvents.ts`, `src/modules/timeline/entities/artwork-timeline-event.entity.ts`.

## Problem Statement
The confidentiality model rests on `is_published`, because `?expand=true` is available to any anonymous caller and reveals every **published** expanded-tier row (`admin_note`, `technical`, `attestation`) — the visibility *tier* is a display default, not access control. Yet the column is `NOT NULL DEFAULT true`. The migration's own comment describes an "admin_note publish UPDATE" workflow (created unpublished, later published), which is inconsistent with a column that defaults to published.

Not exploitable in this PR: no writer/manual insert exists for the expanded types, and the emit service hard-codes `is_published=true` only for the two default-tier types. But the moment an admin-note/technical writer (or a manual `INSERT`) omits the flag, the row is immediately anonymous-visible via `?expand=true`. The same caveat applies to `summary`, which is echoed **verbatim** for every event type (no allowlist) — a future admin-authored `admin_note.summary` is a stored-XSS surface for any unescaped consumer and a channel for inadvertent admin PII.

## Findings
- `src/database/migrations/1716000000047-CreateArtworkTimelineEvents.ts:~47` — `"is_published" boolean NOT NULL DEFAULT true`.
- `src/modules/timeline/dto/timeline-event-response.dto.ts:~68` — `summary` passed through unfiltered for all event types.

## Proposed Solutions
### Option A — Flip the default to `false` (opt-in publish), keep the two auto-emitters explicit (Recommended)
`DEFAULT false`; the two current emitters already set `is_published=true` explicitly, so no behavior change today. Future expanded-tier writers must opt into publishing — safe by default.
- Pros: closes the latent hole at the schema level; matches the described admin-note workflow. Cons: needs the migration amended (unreleased) or a follow-up; verify the two emitters set it explicitly (they do).
- Effort: Small · Risk: Low.

### Option B — Keep `DEFAULT true`, add a guard when the admin_note writer lands
Document that admin-authored types MUST insert `is_published=false`, and sanitize/length-limit `summary` on write at that time. Defer to the writer's ticket.
- Pros: no change now. Cons: relies on a future author remembering; the trap ships today.
- Effort: Small (deferred) · Risk: Medium (silent-leak-by-omission).

## Recommended Action
(blank — triage)

## Technical Details
- Affected: migration `047` (default), and a future `admin_note` writer ticket (summary sanitize/escape).
- A `CHECK` can't enforce "false on insert, true later", so the default flip (Option A) is the enforceable lever.

## Acceptance Criteria
- [ ] Decision recorded on `is_published` default.
- [ ] Note added for the future expanded-tier writer: opt-in publish + sanitize/escape `summary`.

## Work Log
- 2026-08-24: Filed from PR #51 review (security-sentinel, P3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/51
