// Quote-acceptance tuning constants (TOV-178 / FR-06.04). Kept out of acceptMessages.ts so that file stays
// copy-only (mirrors the lib/offerings + lib/kyc constants/messages split). Values are FE-owned decisions from
// the plan's deepening pass (docs/plans/2026-08-22-feat-quote-acceptance-ui-plan.md §Deepening D4/D6).

// Prepare/submit/read request timeout. On-chain feasibility (prepare) + settlement submit can take several
// seconds; parity with OFFERING_TIMEOUT_MS but a touch more generous for the accept feasibility read.
export const ACCEPT_TIMEOUT_MS = 15_000;

// ── Settlement poll (useTradePolling) ────────────────────────────────────────────────────────────────
// DIVERGENCE from useMyBidPolling (plan D4/C-5): there is NO hard active-time cap / `timeout` phase — an
// on-chain settlement has no bounded SLA and the backend reconcile guarantees a terminal state (~≤10 min), so
// a "timed out" message on a trade that later settles would be actively misleading. Instead of a flat base
// interval we escalate by how long the trade has been `pending`, so a walked-away foreground tab decays from
// ~20/min to ~3/min rather than hammering `accept/me` (throttle 60/min) forever.
//
// Each stage: poll at `intervalMs` while pending wall-clock (pause-excluded) is below `untilMs`. Base 3s keeps
// the steady state at ~20/min (headroom under the 60/min throttle for a second tab + the reconcile/re-read).
export const ACCEPT_POLL_STAGES: ReadonlyArray<{ untilMs: number; intervalMs: number }> = [
  { untilMs: 15_000, intervalMs: 3_000 }, // 0–15s: fast-settle window (most settlements finish here)
  { untilMs: 60_000, intervalMs: 5_000 }, // 15–60s
  { untilMs: 300_000, intervalMs: 10_000 }, // 1–5 min
  { untilMs: Number.POSITIVE_INFINITY, intervalMs: 20_000 }, // >5 min: "still settling" heartbeat
];

// ±jitter around the staged interval, per client — de-syncs many buyers polling the same settlement worker
// (todo 147; continuous Math.random, never attempt-parity).
export const ACCEPT_POLL_JITTER_RATIO = 0.15;

// Exponential backoff between consecutive TRANSPORT failures (429/5xx/network) — distinct from the pending
// escalation above (which governs successful `pending` polls). 3s → 6s → 12s …, capped.
export const ACCEPT_POLL_BACKOFF_BASE_MS = 3_000;
export const ACCEPT_POLL_BACKOFF_MAX_MS = 24_000;
export const ACCEPT_POLL_MAX_FAILURES = 5; // consecutive transport failures before the poll stops (phase 'error')

// ── Passkey assertion ────────────────────────────────────────────────────────────────────────────────
// Generous, NOT a real bound: browsers clamp/ignore the WebAuthn `timeout` hint (Firefox ~30s, Safari ~2min,
// Chrome hours — plan D6). Cancel-vs-timeout is classified from the returned error, never from this firing.
// Set to the current spec default (5 min) so a slow cross-device (hybrid/QR) signature isn't cut short.
export const ACCEPT_ASSERTION_TIMEOUT_MS = 300_000;

// NOTE: there is deliberately NO list poller / ACCEPT_LIST_POLL_* constant. The open-quotes list is static
// SSR-seeded with a manual `router.refresh()` control (plan D5 — useOpenQuotesPolling was cut).

// Feature-neutral money constants (STROOPS_PER_USDC, USDC_DECIMALS, I128_MAX, U96_MAX) live in
// lib/money/constants.ts — import from there directly (do not re-export a marketplace-local copy).
