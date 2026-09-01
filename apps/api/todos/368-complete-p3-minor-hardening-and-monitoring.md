---
status: complete
priority: p3
issue_id: 368
tags: [code-review, hardening, tov-174, pr-47]
dependencies: []
---
# Minor hardening + monitoring notes (PR #47)

## Problem Statement
A handful of low-severity robustness/hygiene notes. None are defects today; each removes a silent reliance on
an invariant or a theoretical edge.

## Findings
Source: security-sentinel (L2, L3), data-integrity-guardian (informational), code-simplicity-reviewer (#2).

1. **Inbox JOIN does not filter `artworks.deleted_at`.** (security L2, INFO)
   `src/modules/marketplace/notifications/repositories/rfq-notification.repository.ts:63` inner-joins
   `artworks` on id only. A soft-deleted artwork's `title`/`image_url` would still render. Not a leak (the
   recipient is a legitimate holder of that artwork), but decide intentionality; add `AND a.deleted_at IS NULL`
   if soft-deleted artworks should drop from the inbox.

2. **Non-UUID JWT `sub` would 500, not leak.** (security L3, theoretical)
   The raw unread probe compares `recipient_sub` (uuid) to a text-bound `$1`; a malformed `sub` → Postgres
   `22P02` → generic 500. All real subs are UUIDs. Optional: an explicit `$1::uuid` cast makes the intent
   explicit rather than relying on implicit coercion.

3. **`IDX_rfq_notifications_unread` omits `deleted_at IS NULL` from its predicate** (data-integrity INFO).
   Harmless *only because* `fn_rfq_notifications_guard` blocks soft-delete, so `deleted_at` is always NULL. It
   silently relies on that invariant — worth a one-line comment on the index (migration 042).

4. **`CHK_notif_channel CHECK (channel IN ('in_app'))` guards a write path that doesn't exist** (simplicity #2).
   The app never writes `channel` (relies on `DEFAULT 'in_app'`); the tuple-as-const + entity type prevent
   drift, and the CHECK must be `ALTER`ed the moment `email` ships. Low-value; optional to drop.

5. **Monitoring: alert on fan-out amplification + retry-exhaustion.** (from the plan's Risk section + todo 361)
   Add an alert on notification-write volume (a whitelisted collector can flood inboxes over time) and on RFQs
   un-latched past the retry horizon (surfaces the todo-361 failure before the 24h orphan cliff). The deploy
   runbook already has the SQL — wire it to alerting.

## Proposed Solutions
Per-item small edits / comments; item 5 is an ops/alerting task, not code.

## Resolution (2026-08-21, complete)
1. **Soft-deleted artwork:** user chose **keep rendering + document**. Added a comment on the `artworks` join
   in `inboxQuery` explaining the deliberate omission of `a.deleted_at` (a holder still sees notifications for
   an artwork they hold; not a leak). No behavior change.
2. **Non-UUID sub:** added an explicit `$1::uuid` cast to the unread-count probe so the intent is explicit
   (a non-UUID sub — never a real user id — fails the cast rather than via silent coercion).
3. **Unread index `deleted_at` reliance:** documented on the `IDX_rfq_notifications_unread` DDL in migration
   042 that omitting `deleted_at IS NULL` is safe only because the guard blocks soft-delete (comment only — DDL
   unchanged, no test-DB re-setup needed).
4. **CHK_notif_channel:** KEPT — a cheap single-value belt; removing a CHECK for cosmetics isn't worth it.
5. **Monitoring (fan-out amplification + retry-exhaustion alerts):** ops/alerting task, not code. The deploy
   runbook already carries the SQL (SLA percentiles, reconcile-loop detector). Deferred to ops wiring — noted
   here and in the runbook; not blocking.
- Files: `rfq-notification.repository.ts`, `1716000000042-CreateRfqNotificationsTable.ts` (comment). tsc + lint
  clean; e2e 4 green.

## Acceptance Criteria
- [ ] artworks.deleted_at behavior decided (filter or documented); unread-index reliance commented; monitoring
  alerts wired (or explicitly deferred).

## Work Log
- 2026-08-21: Filed from PR #47 review (security + data-integrity + simplicity).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/47
- Deploy runbook: docs/solutions/deployment-issues/2026-08-21-tov174-rfq-notification-fanout-deploy-runbook.md
