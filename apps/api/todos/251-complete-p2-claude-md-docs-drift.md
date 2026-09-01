---
status: complete
priority: p2
issue_id: 251
tags: [code-review, docs, quality, TOV-237, PR-35]
dependencies: []
---

# CLAUDE.md docs drift: the new `me/holdings` surface + `fraction-read.config` are undocumented

## Problem Statement
The PR adds a public authenticated route surface and a config file, but the living CLAUDE.md docs weren't updated — the same class of gap that was a required follow-up on PR #34 (commit `589a89d`).

## Findings
Flagged by pattern-recognition-specialist (P2).
- `src/modules/CLAUDE.md` — the `fractionalization/` bullet still says "Provider-only + neutral (no route surface)" and lists only `deploy/` + the backoffice HTTP surface. It does not mention `PublicMeHoldingsModule` → `MeHoldingsController` (`@Controller('me/holdings')`) added to `PUBLIC_MODULES`. Every other `me/`-style surface (`wallets/me/`, `users/handle/`, `kyc/`, `collectors/`) is documented here — real precedent gap; the "(no route surface)" phrasing is now stale.
- `src/config/CLAUDE.md` — the `## Files` list enumerates every config except the new `fraction-read.config.ts`. Add an entry (note: holds no signing secret; derives the read source pubkey from `FRACTION_RELAYER_SECRET`).
- Root `CLAUDE.md` — the `fractionalization/` one-liner could optionally note the read surface (lower priority).

## Proposed Solutions
1. Update `src/modules/CLAUDE.md` (fractionalization bullet: add the `me/` public read surface; soften "no route surface") + add the `fraction-read.config.ts` entry to `src/config/CLAUDE.md`. Effort: Small. Risk: none.

## Recommended Action
**RESOLVED — Solution 1.** `src/modules/CLAUDE.md`: softened the fractionalization "no route surface" phrasing to note the exception, added a `me/` subfolder paragraph (module/controller/route, `FRACTION_READ_SERVICE`, lockup-display-only, cache + single-flight, 503, config), and appended migration `…031` to the migrations list. `src/config/CLAUDE.md`: added the `fraction-read.config.ts` entry (no signing secret; derived read pubkey; tuning knobs).

## Technical Details
- Docs-only. `src/modules/CLAUDE.md`, `src/config/CLAUDE.md`.

## Acceptance Criteria
- [x] `src/modules/CLAUDE.md` documents the `me/holdings` public surface + migration …031.
- [x] `src/config/CLAUDE.md` lists `fraction-read.config.ts`.

## Work Log
- 2026-07-18: created from PR #35 review (pattern-recognition-specialist P2).
- 2026-07-18: RESOLVED — both CLAUDE.md files updated.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
