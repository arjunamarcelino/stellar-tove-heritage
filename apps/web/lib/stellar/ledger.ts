import 'server-only';

import { z } from 'zod/v4';

import { STELLAR_NETWORK } from '@/lib/constants';

// Current-ledger reader for the wallet-rotation proactive freshness check (TOV-48 / FR-01.12). Before
// asking the user to sign, the FE compares the challenge's `expiresAtLedger` against the CURRENT ledger
// height so a stale challenge can be refetched WITHOUT burning a passkey ceremony. Reads PUBLIC Horizon
// (never API_BASE_URL, never a Bearer token) exactly like the trustline badge derive.
//
// Fail-soft contract: this is a best-effort courtesy check — the backend rejects an expired challenge
// regardless — so ANY hiccup (network abort, non-ok status, unparseable body, NaN sequence) resolves to
// `null` and the caller simply skips the proactive check. It NEVER throws.
//
// NOT cached: a cached ledger height is worse than useless (ledgers close every ~5s), so this is always
// a direct, fresh fetch — no unstable_cache / `use cache`.

const HORIZON_TIMEOUT_MS = 2500;

// Horizon `GET /ledgers?order=desc&limit=1&cursor=now` body — only the one field we read. `sequence` is well within
// MAX_SAFE_INTEGER, so it's a plain number (no BigInt); Horizon usually sends it as a JSON number but we
// coerce from string too, rejecting anything that isn't a finite number.
const ledgersPageSchema = z.object({
  _embedded: z.object({
    records: z
      .array(
        z.object({
          sequence: z.union([z.number(), z.string()]),
        }),
      )
      .min(1),
  }),
});

export async function getCurrentLedger(): Promise<number | null> {
  try {
    const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/ledgers?order=desc&limit=1&cursor=now`, {
      signal: AbortSignal.timeout(HORIZON_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const parsed = ledgersPageSchema.safeParse(await res.json());
    if (!parsed.success) return null;

    // `.min(1)` guarantees a record at runtime, but noUncheckedIndexedAccess still types [0] as possibly
    // undefined — guard explicitly so `next build`'s typecheck stays green.
    const first = parsed.data._embedded.records[0];
    if (!first) return null;

    const sequence = Number(first.sequence);
    return Number.isFinite(sequence) ? sequence : null;
  } catch {
    // Network error, abort/timeout, or a non-JSON body → skip the proactive check.
    return null;
  }
}
