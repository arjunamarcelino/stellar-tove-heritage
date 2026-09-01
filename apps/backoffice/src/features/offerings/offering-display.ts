import { ZodError } from 'zod';

import { formatStroops } from '@/lib/amount';
import { isValidContractAddress } from '@/lib/stellar';
import { ApiError } from '@/types/api';

import type { ApproveResponse, EscrowDeployStatus, OfferingStatus } from './schemas';

// Asset symbol for price display. Blank until the payment asset is confirmed (Open Q #2); trivial to
// change here. Prices use the default 7 decimals (see lib/amount DECIMALS).
export const OFFERING_ASSET_SYMBOL = '';

// ── Status display (EXHAUSTIVE Records — no fallback; a 7th status becomes a compile error) ─────────
export const offeringStatusVariant: Record<
  OfferingStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  planned: 'secondary',
  approved: 'default',
  opened: 'default',
  subscribed: 'outline',
  settled: 'outline',
  canceled: 'destructive',
};

export const offeringStatusLabel: Record<OfferingStatus, string> = {
  planned: 'Planned',
  approved: 'Approved',
  opened: 'Opened',
  subscribed: 'Subscribed',
  settled: 'Settled',
  canceled: 'Canceled',
};

// ── Approve error routing (pure, exhaustive — shared by the hook AND any headless caller) ───────────
export const OFFERING_ERROR_CODES = [
  'OFFERING_NOT_PLANNED',
  'OFFERING_APPROVAL_IN_PROGRESS',
  'OFFERING_APPROVAL_NOT_A_SIGNER',
  'IDEMPOTENCY_KEY_IN_FLIGHT',
  'IDEMPOTENCY_KEY_MISMATCH',
  'OFFERING_NOT_FOUND',
  'VALIDATION_FAILED',
] as const;
export type OfferingErrorCode = (typeof OFFERING_ERROR_CODES)[number];

export type ApproveErrorClass = 'neutral' | 'not-a-signer' | 'error';

// `neutral` = the approval effectively succeeded / is already underway → refetch, never a red toast.
const APPROVE_ERROR_ROUTING: Record<OfferingErrorCode, ApproveErrorClass> = {
  OFFERING_APPROVAL_IN_PROGRESS: 'neutral', // someone else reached quorum / deploy underway
  IDEMPOTENCY_KEY_IN_FLIGHT: 'neutral', // our own same-submit double-click
  OFFERING_NOT_PLANNED: 'neutral', // already left `planned` → refetch; fresh state drives the view
  OFFERING_APPROVAL_NOT_A_SIGNER: 'not-a-signer',
  IDEMPOTENCY_KEY_MISMATCH: 'error',
  OFFERING_NOT_FOUND: 'error',
  VALIDATION_FAILED: 'error',
};

/** Classify an approve error by its stable `errorCode`. Unknown/unlisted codes → 'error'. */
export function classifyApproveError(code: string): ApproveErrorClass {
  return code in APPROVE_ERROR_ROUTING
    ? APPROVE_ERROR_ROUTING[code as OfferingErrorCode]
    : 'error';
}

export type ApproveOutcome =
  | { kind: 'accepted'; deploying: boolean } // 202 recorded (response body itself is not consumed)
  | { kind: 'neutralized' } // conflict meaning "already succeeded / underway" → refetch, no error toast
  | { kind: 'not-a-signer' }; // 403 off-roster → persistent panel state, not a toast

/**
 * Pure mapping of an approve result-or-error to the discriminated {@link ApproveOutcome}. Importable so a
 * headless/agent caller of `approveOffering` classifies exactly as the UI does.
 * - `ApiError` with a neutral/not-a-signer code → that outcome; other `ApiError` codes → rethrow.
 * - `ZodError` → the POST returned 2xx but the body drifted: treat as ACCEPTED-uncertain (`deploying:false`)
 *   so the caller refetches to reconcile instead of showing a retryable error + re-submitting a signature.
 * - Any other `Error` (network) → rethrow for the caller's error path.
 */
export function classifyApproveOutcome(resultOrError: ApproveResponse | unknown): ApproveOutcome {
  if (resultOrError instanceof ApiError) {
    const klass = classifyApproveError(resultOrError.code);
    if (klass === 'neutral') return { kind: 'neutralized' };
    if (klass === 'not-a-signer') return { kind: 'not-a-signer' };
    throw resultOrError;
  }
  if (resultOrError instanceof ZodError) return { kind: 'accepted', deploying: false };
  if (resultOrError instanceof Error) throw resultOrError; // network etc. — genuine error
  const response = resultOrError as ApproveResponse;
  return { kind: 'accepted', deploying: response.escrow.deployStatus === 'deploying' };
}

// Minimal structural shape both the list item and detail satisfy.
interface DeployGateInput {
  status: OfferingStatus;
  escrow: { deployStatus: EscrowDeployStatus; contractAddress: string | null };
  approvals: { count: number; threshold: number };
}

/**
 * Is an escrow deploy in flight? Composite gate (folds the transient window I5): the backend flag OR a
 * quorum-reached `planned` offering not yet failed. Drives poll arming + CTA lock. NOTE: a
 * session-monotonic latch in the lifecycle hook keeps this "sticky" against a single regressing poll body.
 */
export function isDeployInFlight(d: DeployGateInput): boolean {
  if (d.escrow.deployStatus === 'deploying') return true;
  return (
    d.status === 'planned' &&
    d.approvals.count >= d.approvals.threshold &&
    d.escrow.deployStatus !== 'failed'
  );
}

/** Fully latched success: deployed + approved + a VALID contract address (not merely non-null). */
export function isLatched(d: DeployGateInput): boolean {
  return (
    d.escrow.deployStatus === 'deployed' &&
    d.status === 'approved' &&
    d.escrow.contractAddress !== null &&
    isValidContractAddress(d.escrow.contractAddress)
  );
}

/** The valid escrow address IF fully latched, else null — lets callers avoid an `as string` cast. */
export function latchedAddress(d: DeployGateInput): string | null {
  return isLatched(d) ? d.escrow.contractAddress : null;
}

// ── Money display ──────────────────────────────────────────────────────────────────────────────────
/** Price band at FULL precision (load-bearing — admins approve against it). */
export function formatPriceBand(lowStroops: string, highStroops: string): string {
  const sym = OFFERING_ASSET_SYMBOL || undefined;
  return `${formatStroops(lowStroops, undefined, undefined, { symbol: sym })} – ${formatStroops(
    highStroops,
    undefined,
    undefined,
    { symbol: sym },
  )}`;
}

/** Public float as a grouped integer token count (decimals 0). */
export function formatPublicFloat(publicFloatStroops: string): string {
  return formatStroops(publicFloatStroops, 0);
}

// ── Countdown ────────────────────────────────────────────────────────────────────────────────────
/** Remaining milliseconds until `target` (ISO), clamped at 0. `nowMs` is injected for testability. */
export function remainingMs(targetIso: string, nowMs: number): number {
  const target = Date.parse(targetIso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, target - nowMs);
}

/** Human countdown ("2d 3h 4m", "3h 4m", "5m 12s") or "Window open" once elapsed. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Window open';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3_600);
  const minutes = Math.floor((totalSec % 3_600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
