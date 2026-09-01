import type { StellarAsset } from '@/lib/types/api';

// Neutral, SDK-free AND zod-free shared core for the BYOW USDC trustline flow (TOV-47). NO directive:
// importable from both the `server-only` badge derive (lib/services/trustlineStatus.ts) and the
// `'use client'` engine (lib/stellar/trustline.ts) — those two must never import each other. Keeping this
// SDK-free (and zod-free — the Horizon Zod schema lives in lib/stellar/horizonSchema.ts, server-consumed)
// is what lets the server derive avoid bundling @stellar/stellar-sdk and the client keep both the SDK and
// zod out of the settings bundle.
//
// Purpose: pure classification of a Horizon account's balances — "does this account hold an authorized
// USDC line for {code, issuer}?" — plus small extractors used by the reserve math. All I/O + parsing
// (SDK loadAccount / plain fetch + horizonSchema) lives in the callers.

// ── Strkey validation (defence-in-depth before any Horizon path interpolation) ──
// Stellar ed25519 public keys are 56-char base32 strings beginning with 'G'.
const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
export function isValidStellarPublicKey(address: string): boolean {
  return STELLAR_PUBLIC_KEY.test(address);
}

// A structural balance shape both the Zod-parsed body and the SDK's AccountResponse.balances satisfy,
// so the client engine can reuse `classifyUsdcTrustline` on SDK-loaded balances without importing this
// module's Zod types.
export interface BalanceLineLike {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  is_authorized?: boolean;
  selling_liabilities?: string;
}

// Does the account hold a ready-to-receive USDC line for `asset`? 'active' vs 'missing'.
// USDC (testnet issuer) is NOT auth_required, so `is_authorized` is typically absent/true; we treat an
// explicit `false` (line exists but issuer hasn't authorized it) as not-yet-ready → 'missing'.
// DELIBERATE two-state: we do NOT model a distinct 'unauthorized' UI state, because platform USDC isn't
// auth_required so that case can't arise for it. If an auth-required asset is ever added, revisit this
// (an unauthorized line drives the "add trustline" CTA today, which change_trust can't resolve).
export function classifyUsdcTrustline(
  balances: readonly BalanceLineLike[],
  asset: StellarAsset,
): 'active' | 'missing' {
  const line = balances.find(
    (b) =>
      b.asset_type !== 'native' && b.asset_code === asset.code && b.asset_issuer === asset.issuer,
  );
  if (!line) return 'missing';
  return line.is_authorized === false ? 'missing' : 'active';
}

// Native (XLM) balance as a decimal string ('0' if the account holds no native line — shouldn't happen
// for a funded account, but safe).
export function getNativeBalance(balances: readonly BalanceLineLike[]): string {
  return balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
}

// Native selling liabilities as a decimal string ('0' when absent). Subtracted from the free balance in
// the reserve precheck so an account with open offers isn't mis-read as fundable.
export function getNativeSellingLiabilities(balances: readonly BalanceLineLike[]): string {
  return balances.find((b) => b.asset_type === 'native')?.selling_liabilities ?? '0';
}
