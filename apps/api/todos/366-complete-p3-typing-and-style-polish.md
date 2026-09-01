---
status: complete
priority: p3
issue_id: 366
tags: [code-review, cleanup, typescript, tov-174, pr-47]
dependencies: []
---
# Typing + style polish cluster (PR #47)

## Problem Statement
Small type/style nits, none affecting behavior; grouped for one cleanup pass.

## Findings
Source: kieran-typescript-reviewer (#5,#6,#7), code-simplicity-reviewer (#8,#9), pattern-recognition-specialist (NIT).

1. **`countUnreadForRecipient` row type says `string`, SQL returns a number.**
   `src/modules/marketplace/notifications/repositories/rfq-notification.repository.ts:121` types
   `Array<{ count: string }>`, but the query is `count(*)::int` → `int4` deserializes to a JS `number` via
   `pg` (only `int8`/bigint returns a string). `Number(...)` papers over it. Tighten to `{ count: number }`.

2. **`filter` enum literals repeated 3×.**
   `src/modules/marketplace/notifications/dto/list-notifications-query.dto.ts:11-14` — `['unread','all']`
   appears in `@ApiPropertyOptional`, `@IsIn`, and the `'unread'|'all'` union. The constants leaf next door
   models the tuple-as-const pattern (`NOTIFICATION_CHANNELS`). Add `const NOTIFICATION_FILTERS =
   ['unread','all'] as const` + derived type, feed all three.

3. **`RfqsService` logger declared *after* the constructor.**
   `src/modules/marketplace/rfqs/rfqs.service.ts:62` — every other class in the PR declares the logger as the
   first field, above the constructor. Move it up for consistency.

4. **Twin constants with identical value.**
   `src/modules/marketplace/notifications/constants/rfq-notification.constants.ts:11,17` —
   `RFQ_FANOUT_RECONCILE_QUEUE` and `RFQ_FANOUT_SCHEDULER_KEY` are both `'rfq-fanout-reconcile'`. Semantically
   distinct namespaces (queue name vs repeatable-job name) so not a bug, but a future rename of one without the
   other reads confusingly. The fraction precedent uses a plain `'reconcile'` job name; a distinct
   scheduler-key value would remove the ambiguity. Cosmetic.

5. **`insertManyIgnoreConflicts` boolean/return surface wider than production needs** — covered by todo 364
   (drop the `RETURNING`/count). `markRead`'s `Promise<boolean>` is only used by tests now — acceptable, noting only.

## Proposed Solutions
Straightforward edits per item; all Small effort / no risk.

## Resolution (2026-08-21, complete)
1. `countUnreadForRecipient` row type `{ count: string }` → `{ count: number }` (the `::int` returns a JS
   number); dropped the now-redundant `Number(...)` wrapper.
2. Added `NOTIFICATION_FILTERS = ['unread','all'] as const` + `NotificationFilter` type in the constants leaf;
   `ListNotificationsQueryDto` feeds it into the `@ApiPropertyOptional` enum, `@IsIn`, and the field type — no
   more 3× literal repetition.
3. Moved `RfqsService`'s `logger` field above the constructor (consistent with every other class in the PR).
4. Twin-constant ambiguity: `RFQ_FANOUT_SCHEDULER_KEY` changed from `'rfq-fanout-reconcile'` (== the queue name)
   to `'reconcile'` (the repeatable-job name, mirroring the fraction scheduler) so the two constants no longer
   share a literal. Safe — new feature, no persisted repeatable to migrate; scheduler is test-disabled.
- Files: `rfq-notification.repository.ts`, `constants/rfq-notification.constants.ts`,
  `dto/list-notifications-query.dto.ts`, `rfqs.service.ts`. tsc + lint clean; unit 29 green.

## Acceptance Criteria
- [ ] `count` typed as `number`; `filter` values derive from one tuple-const; logger placement consistent;
  the twin-constant ambiguity resolved or commented.

## Work Log
- 2026-08-21: Filed from PR #47 review (typescript + simplicity + pattern).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/47
