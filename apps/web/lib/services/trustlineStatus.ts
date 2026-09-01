import 'server-only';

import { unstable_cache } from 'next/cache';

import { PLATFORM_USDC, STELLAR_NETWORK } from '@/lib/constants';
import { classifyUsdcTrustline, isValidStellarPublicKey } from '@/lib/stellar/account';
import { horizonAccountSchema } from '@/lib/stellar/horizonSchema';
import type { TrustlineStatus } from '@/lib/types/api';

// WS3 — server-side trustline badge derive (TOV-47 / FR-01.11). Answers "does this BYOW address hold an
// authorized platform-USDC line?" for the settings badge, reading PUBLIC Horizon (never API_BASE_URL,
// never a Bearer token). Token-free and cookie-free by construction so its result can be safely shared
// across viewers via Next's data cache — it MUST NOT read cookies()/headers().
//
// Fail-open contract: any Horizon hiccup (non-404 error, network abort, unparseable body) resolves to
// 'unknown' so the badge degrades to a neutral "check unavailable" rather than a false "needed"/"ready".
// Crucially, that fail-open state is NEVER cached: the cached inner readStatus() THROWS on error, so
// unstable_cache stores nothing, and the OUTER try/catch returns an uncached 'unknown'. Only real states
// (active / missing / unfunded) ever land in the cache.

const HORIZON_TIMEOUT_MS = 2500;
const CACHE_REVALIDATE_SECONDS = 300;

// Single source of truth for the per-address cache tag, so the derive and the revalidation action can't
// drift. Busted by revalidateTrustlineStatus (app/actions/trustline.ts) after a successful add.
// NOTE (follow-up): `unstable_cache` is deprecated in Next 16 in favour of `use cache`; migrate when the
// codebase adopts it. Kept here because the throw-inside-cached-fn trick fails open WITHOUT caching.
export function trustlineTag(address: string): string {
  return `trustline:${address}`;
}

// Cached inner read. Throws on any Horizon error / parse-fail so the outer catch can fail open WITHOUT
// caching that transient failure. A 404 (account not yet funded on-chain) is a real, cacheable answer.
async function readStatus(address: string): Promise<TrustlineStatus> {
  const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/accounts/${encodeURIComponent(address)}`, {
    signal: AbortSignal.timeout(HORIZON_TIMEOUT_MS),
  });

  if (res.status === 404) return 'unfunded';
  if (!res.ok) throw new Error(`horizon ${res.status}`); // uncached → 'unknown'

  const parsed = horizonAccountSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error('horizon parse'); // uncached → 'unknown'

  // issuer is proven non-falsy by the guard in deriveTrustlineStatus before we ever reach here.
  return classifyUsdcTrustline(parsed.data.balances, {
    code: PLATFORM_USDC.code,
    issuer: PLATFORM_USDC.issuer!,
  });
}

export async function deriveTrustlineStatus(address: string): Promise<TrustlineStatus> {
  // Mainnet pre-audit: no configured issuer → the feature is gated to a neutral "check unavailable".
  if (!PLATFORM_USDC.issuer) return 'unavailable';
  // Defence-in-depth: never interpolate an unvalidated address into the Horizon URL.
  if (!isValidStellarPublicKey(address)) return 'unknown';

  try {
    // Keyed AND tagged by address so revalidateTrustlineStatus() can bust exactly this account after a
    // successful trustline change (see app/actions/trustline.ts).
    return await unstable_cache(() => readStatus(address), ['trustline-status', address], {
      revalidate: CACHE_REVALIDATE_SECONDS,
      tags: [trustlineTag(address)],
    })();
  } catch {
    // Fail-open: Horizon threw (non-404 status, network/abort, or parse-fail). Return an UNCACHED
    // 'unknown' — the throw inside the cached fn means nothing was stored.
    return 'unknown';
  }
}
