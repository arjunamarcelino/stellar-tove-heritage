import { z } from 'zod/v4';
import { handleSchema } from '@/lib/handle/schemas';
import type { CheckHandleResult } from '@/lib/types/api';

// Client-side availability check (TOV-43 / B1). Called DIRECTLY from the browser — NOT through a
// Server Action — so the backend's per-IP throttle sees the real client IP (a Server Action would put
// every user behind the Next server's single egress IP and collapse the 30/60s budget globally). This
// is the one deliberate divergence from the "components never fetch the backend directly" convention;
// it is safe here because the endpoint is public, tokenless, and read-only. Uses the browser's own
// AbortController so a superseded check is genuinely cancelled (reclaiming throttle budget).
//
// The endpoint always returns 200 with { handle, available, reason? } — 4xx/5xx are throttle/transport
// only. An aborted fetch throws and is reported as NETWORK_ERROR; the caller's seq guard drops it as
// stale (only a NEW check aborts the previous one, so an aborted result always has a stale seq).
//
// A local timeout combines with the caller's abort signal into one controller: a hung request (server
// accepts but never responds) aborts after CHECK_TIMEOUT_MS and surfaces as a retriable NETWORK_ERROR,
// so the UI can't sit in `checking` forever. Uses a manual setTimeout (not AbortSignal.timeout) so the
// timeout is deterministically testable with fake timers.

const CHECK_TIMEOUT_MS = 6_000;

// Only `available`/`reason` are read — the echoed `handle` is intentionally not modeled (Zod strips it),
// so nothing can accidentally start rendering an unverified server echo. Error codes are mapped inline
// (429 → RATE_LIMITED, else SERVER_ERROR; catch → NETWORK_ERROR) rather than via the exhaustive
// Record<Code,boolean> gate the server services use — deliberate: this is a client module for an
// always-200 endpoint with only three transport codes.
const checkResponseSchema = z.object({
  available: z.boolean(),
  reason: z.enum(['taken', 'reserved', 'invalid_format']).optional(),
});

export async function checkHandle(
  handle: string,
  signal?: AbortSignal,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<CheckHandleResult> {
  // Defense-in-depth: the sole caller (useHandlePicker) already gates on handleSchema, but a malformed
  // handle must never reach the public endpoint regardless of caller. A schema failure is the same
  // verdict the backend would return.
  if (!handleSchema.safeParse(handle).success) {
    return { status: 'unavailable', reason: 'invalid_format' };
  }

  // Same var also drives proxy.ts's CSP connect-src (todo 103): if it's unset/malformed the CSP drops
  // the backend origin AND this returns SERVER_ERROR — a misconfig fails safe (checks error, nothing leaks).
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', code: 'SERVER_ERROR' };

  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/v1/handles/check?handle=${encodeURIComponent(handle)}`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      return { status: 'error', code: res.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR' };
    }

    const data: unknown = await res.json();
    const parsed = checkResponseSchema.safeParse(data);
    if (!parsed.success) return { status: 'error', code: 'SERVER_ERROR' };

    if (parsed.data.available) return { status: 'available' };
    // Always-200 contract guarantees a reason when unavailable; default defensively.
    return { status: 'unavailable', reason: parsed.data.reason ?? 'invalid_format' };
  } catch {
    // Abort (superseded → dropped by the caller's seq guard), timeout, or a genuine network failure.
    return { status: 'error', code: 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}
