---
status: complete
priority: p3
issue_id: 193
tags: [code-review, reliability, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17) — Option A (BullMQ reconciliation job)
Built the scheduled sweeper under `src/modules/kyc/sweep/`:
- `SupabaseStorageService.listObjectsOlderThan(prefix, olderThanMs)` — recursive bucket walk (folders have
  `id === null`), returning keys older than the grace window; exposed via a new `IKycStorageService` port.
- `KycOrphanSweepService.sweep()` — lists KYC objects older than the grace window, compares against ALL
  `kyc_documents.storage_key` (`withDeleted: true`, since soft-deleted blobs are retained), and best-effort
  `delete`s the orphans. Returns `{scanned, orphans, deleted}`.
- `kyc-orphan-sweep` BullMQ queue + `KycOrphanSweepProcessor` + `KycSweepScheduler` (registers a repeatable
  job on boot; idempotent; skipped when `KYC_SWEEP_ENABLED=false`).
- New shared `KycStorageModule` provides/exports `KYC_STORAGE` (imported by both the public submit surface
  and the sweep module — one instance, one wiring).
- Config: `KYC_SWEEP_ENABLED` (default true), `KYC_SWEEP_CRON` (default `0 3 * * *`), `KYC_ORPHAN_GRACE_HOURS`
  (default 48). `KYC_SWEEP_ENABLED=false` in the e2e env so tests don't schedule the job.
- Registered `KycSweepModule` in `app.module`. Unit tests (4) cover orphan-delete/known-keep, grace window,
  no-op-on-empty, and soft-deleted-retained. Full gate green (unit 409, integration 103, e2e 124, build, lint).

# KYC: no orphan-blob sweeper — a crash between upload and DB commit leaks ciphertext permanently

## Problem Statement
Blob cleanup is best-effort only: `cleanup()` runs on the caught-failure path. A pod crash/SIGKILL
between `storage.upload` and the DB commit (or a `cleanup` `allSettled` rejection) leaves ciphertext
in the bucket with no `kyc_documents` row and nothing to reap it. Over time: unbounded storage growth
and un-auditable PII-at-rest (blobs with no submission record). This was a known deferred follow-up (D5);
filing it as a tracked todo.

## Findings
- `src/modules/kyc/kyc.service.ts:183,223-225` — `cleanup(uploaded)` via `Promise.allSettled` runs only in the failure `catch`; no reconciliation job exists.
- Deterministic `submissionId` ([SEC-H2] in `kyc.util.ts`) means an idempotent retry reuses the same keys (`upsert:false` → no new orphan on retry), which narrows but does not eliminate the crash window.

## Proposed Solutions
### Option A (recommended): scheduled reconciliation job (BullMQ)
- A periodic job lists `tove-kyc` object keys, left-joins against `kyc_documents.storage_key`, and deletes objects with no matching row older than a grace window (e.g. 48h to avoid racing an in-flight submit). **Pros:** the real backstop; bounded storage. **Cons:** new job + Supabase list pagination. **Effort: Medium.**

### Option B: interim monitoring only
- Alert on bucket-object-count vs `kyc_documents` live-row count drift (>0 net/day) and reconcile manually until the job ships. **Effort: Small.**

## Recommended Action
_(triage)_

## Technical Details
- Affected (new): a BullMQ processor under `src/modules/jobs/` + a KYC storage `list` capability.
- Interim DB-side proxy query (from the deploy review): compare live `kyc_documents` count to ~4× pending submissions.

## Acceptance Criteria
- [ ] Orphan ciphertext (no `kyc_documents` row, older than the grace window) is reaped automatically, or an alert fires on drift with a documented manual procedure.

## Work Log
- 2026-07-17: Filed from PR #30 review (deployment-verification P2-1; plan D5). No code changed.
