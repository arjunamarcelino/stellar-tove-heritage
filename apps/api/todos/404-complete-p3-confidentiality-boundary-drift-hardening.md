---
status: complete
priority: p3
issue_id: 404
tags: [code-review, tov-191, pr-51, security, typescript, maintenance]
dependencies: []
---
# Confidentiality-boundary drift hardening: allowlist keys + the third copy of the tier CASE

## Resolution (2026-08-24) — Option A
**Allowlist ↔ payload types:** the read-side `METADATA_ALLOWLIST` entries for the two written types are now `as const satisfies readonly (keyof FractionalizationEventData)[]` / `(keyof SecondaryTradeEventData)[]`. A rename/removal on a payload interface is now a **compile break**, and `secondary_trade` physically cannot list `txHash` (not a key of its payload type) — the confidentiality boundary's inner half is compiler-enforced.

**Entity CASE ↔ single source:** the entity's inert `asExpression` mirror is now **derived** from the shared `DEFAULT_TIER_EVENT_TYPES` constant (`CASE WHEN "event_type" IN (${DEFAULT_TIER_SQL_LIST}) …`) instead of a third hand-copied literal, so it can't silently drift. The migration stays authoritative for the real column; the migration↔constant pair remains integration-drift-guarded via `tierForEventType`.
- Files: `src/modules/timeline/dto/timeline-event-response.dto.ts`, `src/modules/timeline/entities/artwork-timeline-event.entity.ts`.
- Verified: build + lint green; timeline unit + integration pass (incl. the no-PII allowlist + generated-column drift tests).

## Problem Statement
Two security-relevant transcriptions can silently drift with no compile break — the exact failure mode the belts exist to prevent.

**1 — `METADATA_ALLOWLIST` keys are free string literals.** The read-side PII allowlist values (`'tokenAddress'`, `'deployLedger'`, `'txHash'`, `'fractionCount'`, …) are not tied to `keyof FractionalizationEventData` / `keyof SecondaryTradeEventData`. A rename/removal on the payload type won't break the allowlist. The outer `Record<TimelineEventType, …>` exhaustiveness is correctly enforced; this is the un-guarded inner half of the confidentiality boundary.

**2 — the tier CASE now lives in three places; only two are drift-guarded.** The default-tier allowlist is written out in the migration (authoritative generated column), in `DEFAULT_TIER_EVENT_TYPES` (constant), and again as the entity's `asExpression` CASE. The migration↔constant pair IS drift-guarded by an integration test (`tierForEventType`). The entity's `asExpression` copy is **not** guarded and is entirely inert at runtime (reads/emits use raw `DataSource` SQL, never the repository), so it's a third silently-driftable transcription of the security-critical CASE that does nothing.

## Findings
- `src/modules/timeline/dto/timeline-event-response.dto.ts:17-27` — `METADATA_ALLOWLIST` free-string keys.
- `src/modules/timeline/entities/artwork-timeline-event.entity.ts:29-31` — third (unguarded, inert) copy of the tier CASE.
- Guarded pair: `1716000000047-CreateArtworkTimelineEvents.ts:42-45` ↔ `constants/timeline-event.constant.ts:24-31` ↔ test `timeline-emit.integration.spec.ts:107-121`.

## Proposed Solutions
### Option A — Tie the allowlist to `keyof` payloads + point the entity CASE at the single source (Recommended)
For (1): type `METADATA_ALLOWLIST[fractionalization]` as `readonly (keyof FractionalizationEventData)[]` (or a `satisfies` map keyed on the payload interfaces) so a payload rename is a compile break. For (2): either replace the entity's literal CASE text with a comment referencing the migration as authoritative, or build the `asExpression` from the shared `DEFAULT_TIER_EVENT_TYPES` so all copies derive from one list.
- Pros: turns the confidentiality boundary's drift into a compile error / single source. Cons: mirroring STORED columns on entities is house convention — keep the entity CASE, just make it non-authoritative/derived.
- Effort: Small · Risk: Low.

### Option B — Add a drift test for the entity CASE too
An integration test asserting the entity's `asExpression` matches the DB generated column (`pg_get_expr`) — mirrors the pattern used for `pg_get_constraintdef` elsewhere.
- Pros: catches drift at test time without restructuring. Cons: another test to maintain; doesn't help the allowlist.
- Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `timeline-event-response.dto.ts`, `artwork-timeline-event.entity.ts` (+ optional test).

## Acceptance Criteria
- [ ] A rename/removal of a payload field breaks the build if the allowlist isn't updated.
- [ ] The entity's tier CASE is either non-authoritative-by-comment, derived from the shared constant, or drift-tested.

## Work Log
- 2026-08-24: Filed from PR #51 review (kieran-typescript + code-simplicity).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/51
