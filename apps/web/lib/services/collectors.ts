import 'server-only';

import { z } from 'zod/v4';
import { getJson } from '@/lib/services/http';
import type { CollectorProfileResult } from '@/lib/types/api';

// Public collector profile read (TOV-44 / FR-01.06). Unlike the FR-01.05 availability CHECK (a
// per-IP-throttled endpoint called DIRECTLY from the browser), this is a plain server-to-server SSR
// read via the shared http.ts seam — no CSP change, no client sequencing. "Public" = no Bearer token,
// NOT client-side: the call still uses API_BASE_URL (server-only), so this module is `server-only`.

const GET_COLLECTOR_TIMEOUT_MS = 5_000; // plain DB read — no on-chain latency (cf. handle.ts's 10s)

// Conservative SUPERSET of the backend's accepted handle grammar — ASCII [A-Za-z0-9._-] + length
// ceiling ONLY (no structural first/last-char or no-double-separator rules). A read-path guard must
// only ever UNDER-reject: rejecting a handle the backend WOULD accept is a silent false 404, invisible
// in backend logs (todo 108). Junk still short-circuits without a backend call; any backend-valid
// handle passes through to the backend's own 404. 24 = backend MAX_HANDLE_LENGTH.
const PLAUSIBLE_HANDLE = /^[A-Za-z0-9._-]{1,24}$/;

// Confirmed contract (tove-be PR #29, collector-profile-response.dto.ts): camelCase `previousHandles`
// — newest-first, deduped-by-canonical, current handle already excluded, display-cased, capped at 50,
// and `[]` when the collector opted out (handle_history_public=false). `createdAt` (YYYY-MM-DD) is also
// returned but out of scope here (FR-01.09) — Zod strips it. So NO frontend normalization is needed;
// trust the backend. Tolerant at the OBJECT level (unknown fields stripped; previousHandles
// absent/null → []); element-level strictness is INTENTIONAL — a non-string element fails the parse →
// error (a backend contract break earns the retryable error boundary, not a silent half-render).
const collectorResponseSchema = z.object({
  handle: z.string().trim().min(1),
  previousHandles: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});

// 404 → not_found (no such profile); everything else non-ok → error. Confirmed against tove-be: this
// endpoint only emits 404 (COLLECTOR_NOT_FOUND) for a missing profile, so a 400/422 would be an
// unexpected server-side anomaly and routes to the retryable error boundary, not a false 404 (todo 114).
export async function getCollectorByHandle(handle: string): Promise<CollectorProfileResult> {
  // Defense-in-depth: short-circuit obviously-malformed handles to not_found WITHOUT a backend call
  // (cuts enumeration/amplification). Uses a conservative superset (see PLAUSIBLE_HANDLE) so it can
  // never over-reject a backend-valid handle into a silent 404.
  if (!PLAUSIBLE_HANDLE.test(handle)) return { status: 'not_found' };

  // encodeURIComponent is belt-and-suspenders: PLAUSIBLE_HANDLE already guarantees a URL-safe segment
  // (no `/ % ? #` etc.), so it's a no-op for every handle that reaches here — kept as defense in case
  // the guard is ever loosened (todo 111).
  const outcome = await getJson(`/v1/collectors/${encodeURIComponent(handle)}`, {
    timeoutMs: GET_COLLECTOR_TIMEOUT_MS,
  });

  if (!outcome.ok) {
    if (outcome.status === 404) return { status: 'not_found' };
    return { status: 'error' }; // 5xx / 429 / 400 / 422 / status:0
  }

  const parsed = collectorResponseSchema.safeParse(outcome.data);
  if (!parsed.success) return { status: 'error' };

  // Trust the backend's normalization (dedup / newest-first / current-excluded / capped) — schema note.
  return {
    status: 'success',
    profile: { handle: parsed.data.handle, previousHandles: parsed.data.previousHandles },
  };
}
