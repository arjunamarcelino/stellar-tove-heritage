'use client';

import type * as StellarSdk from '@stellar/stellar-sdk';
import type { StellarAsset, TrustlineErrorCode } from '@/lib/types/api';
import { STELLAR_NETWORK } from '@/lib/constants';
import {
  classifyUsdcTrustline,
  getNativeBalance,
  getNativeSellingLiabilities,
  isValidStellarPublicKey,
  type BalanceLineLike,
} from '@/lib/stellar/account';

// Defence-in-depth: only ever read/submit against an https Horizon (a mis-deploy with http:// would send
// reads/submits in cleartext). Build-time constant, so this is belt-and-suspenders — we degrade
// (fail-open / retryable) rather than throw so a misconfig never hard-crashes the settings page.
function horizonIsHttps(): boolean {
  return STELLAR_NETWORK.horizonUrl.startsWith('https://');
}

// Client-side Stellar trustline engine (TOV-47). `'use client'`; the heavy @stellar/stellar-sdk is
// loaded LAZILY (memoized dynamic import) so it never enters the settings page's first-load JS — mirrors
// lib/wallet/freighter.ts's dynamic import. Every chain op returns a discriminated result and never
// throws across its boundary (except pure builders on invalid input, which the hook wraps). Reserve
// math is exact integer stroops (never binary floats). See lib/stellar/account.ts for the SDK-free core.
//
// Submission uses the blocking `submitTransaction`: its typed `TransactionFailedError.getResultCodes()`
// gives reliable tx_bad_seq / change_trust_low_reserve branching (the crux of correct recovery). On a
// network/timeout error the tx may still land, so we hand back the pre-computed hash for a confirm-poll.
// (Follow-up: Horizon's async `submitAsyncTransaction` avoids the ~30s block but needs errorResultXdr
// decoding for the same codes — deferred.)

// ── Lazy, memoized SDK loader ──
// `import type * as` is fully erased (no runtime import). The memoized promise guarantees a SINGLE
// resolved module instance, which is what keeps `instanceof` (TransactionFailedError / NotFoundError)
// valid — never add a static top-level `import { X } from '@stellar/stellar-sdk'` (D8 two-copy hazard).
let sdkPromise: Promise<typeof StellarSdk> | null = null;
export function loadStellarSdk(): Promise<typeof StellarSdk> {
  return (sdkPromise ??= import('@stellar/stellar-sdk'));
}

// ── Reserve math (exact integer stroops) ──
// BigInt() calls (not `n` literals) so the money math compiles at the repo's ES2017 target.
const STROOPS_PER_XLM = BigInt(10_000_000);
const BASE_RESERVE_STROOPS = BigInt(5_000_000); // 0.5 XLM (one base reserve / one subentry)
const BASE_FEE_STROOPS = BigInt(100); // BASE_FEE, one operation
const ZERO = BigInt(0);

// Parse a Horizon decimal-XLM string ("5.0000000") to integer stroops. 7 dp, sign-safe.
export function xlmToStroops(decimal: string): bigint {
  const neg = decimal.startsWith('-');
  const s = neg ? decimal.slice(1) : decimal;
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0000000').slice(0, 7);
  const stroops = BigInt(whole || '0') * STROOPS_PER_XLM + BigInt(fracPadded || '0');
  return neg ? -stroops : stroops;
}

// Stroops → trimmed decimal-XLM string, for user-facing shortfall copy.
export function stroopsToXlm(stroops: bigint): string {
  const neg = stroops < ZERO;
  const abs = neg ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const frac = (abs % STROOPS_PER_XLM).toString().padStart(7, '0').replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${out}` : out;
}

// Free-XLM shortfall (in stroops) to add one trustline subentry: 0 when the account can afford it.
// minBalanceAfter = (2 + subentryCount + 1) × baseReserve; required = minBalanceAfter + fee; the
// account's spendable native = nativeBalance − sellingLiabilities.
export function trustlineReserveShortfall(input: {
  nativeBalance: string;
  subentryCount: number;
  sellingLiabilities: string;
}): bigint {
  const available = xlmToStroops(input.nativeBalance) - xlmToStroops(input.sellingLiabilities);
  const minAfter = (BigInt(2) + BigInt(input.subentryCount) + BigInt(1)) * BASE_RESERVE_STROOPS;
  const required = minAfter + BASE_FEE_STROOPS;
  const shortfall = required - available;
  return shortfall > ZERO ? shortfall : ZERO;
}

// ── Horizon reads ──
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; response?: { status?: number } } | null;
  return e?.name === 'NotFoundError' || e?.response?.status === 404;
}

export type AccountState =
  | {
      status: 'funded';
      sequence: string;
      subentryCount: number;
      nativeBalance: string;
      sellingLiabilities: string;
      usdcLine: 'active' | 'missing';
    }
  | { status: 'unfunded' }
  | { status: 'horizonUnavailable' };

// Read the bound account's live state once; the hook reuses `sequence` for the build (no re-fetch on
// the happy path). 404 → unfunded; any other error → fail-open horizonUnavailable.
export async function loadAccountState(
  publicKey: string,
  asset: StellarAsset,
): Promise<AccountState> {
  // Fail closed on a malformed address / non-https endpoint (never interpolate an unvalidated address
  // into the Horizon URL); degrade to the neutral fail-open state.
  if (!isValidStellarPublicKey(publicKey) || !horizonIsHttps()) {
    return { status: 'horizonUnavailable' };
  }
  try {
    const sdk = await loadStellarSdk();
    const server = new sdk.Horizon.Server(STELLAR_NETWORK.horizonUrl);
    const account = await server.loadAccount(publicKey);
    // Map SDK balances → the shared structural shape by reading each field by name (not a blanket
    // `as unknown as`), so an SDK field rename becomes a COMPILE error instead of a silent `undefined`.
    const balances: BalanceLineLike[] = account.balances.map((b) => ({
      asset_type: b.asset_type,
      asset_code: 'asset_code' in b ? b.asset_code : undefined,
      asset_issuer: 'asset_issuer' in b ? b.asset_issuer : undefined,
      balance: b.balance,
      is_authorized: 'is_authorized' in b ? b.is_authorized : undefined,
      selling_liabilities: 'selling_liabilities' in b ? b.selling_liabilities : undefined,
    }));
    return {
      status: 'funded',
      sequence: account.sequenceNumber(),
      subentryCount: account.subentry_count,
      nativeBalance: getNativeBalance(balances),
      sellingLiabilities: getNativeSellingLiabilities(balances),
      usdcLine: classifyUsdcTrustline(balances, asset),
    };
  } catch (err) {
    if (isNotFound(err)) return { status: 'unfunded' };
    return { status: 'horizonUnavailable' };
  }
}

// ── Build ──
// Rebuild change_trust from `asset` + the given (fresh) sequence. NO limit → network max. setTimeout(120)
// bounds the envelope (anti-double-submit; required by the SDK). Pure/deterministic — the hook wraps the
// call. A fresh `Account` per build avoids mutating shared sequence state across rebuilds.
export async function buildChangeTrustXdr(input: {
  accountId: string;
  sequence: string;
  asset: StellarAsset;
  networkPassphrase: string;
}): Promise<string> {
  if (!isValidStellarPublicKey(input.accountId)) throw new Error('invalid account id');
  const sdk = await loadStellarSdk();
  const source = new sdk.Account(input.accountId, input.sequence);
  const asset = new sdk.Asset(input.asset.code, input.asset.issuer);
  const tx = new sdk.TransactionBuilder(source, {
    fee: sdk.BASE_FEE,
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(sdk.Operation.changeTrust({ asset }))
    .setTimeout(120)
    .build();
  return tx.toXDR();
}

// ── Submit ──
export type SubmitOutcome =
  | { kind: 'confirmed'; hash: string }
  | { kind: 'rebuild'; cause: 'tx_bad_seq' | 'tx_too_late' } // stale seq / expired → rebuild + re-sign
  | { kind: 'lowReserve' } // change_trust_low_reserve / tx_insufficient_balance → funding guidance
  | { kind: 'accountMismatch' } // tx_bad_auth: signed by a different active account than the source
  | { kind: 'pending'; hash: string } // network/timeout: may still land → confirm-poll by hash
  | { kind: 'failed'; code: TrustlineErrorCode };

function readResultCodes(
  sdk: typeof StellarSdk,
  err: unknown,
): { transaction?: string; operations?: string[] } | null {
  if (err instanceof sdk.TransactionFailedError) return err.getResultCodes();
  const raw = err as { response?: { data?: { extras?: { result_codes?: unknown } } } } | null;
  return (
    (raw?.response?.data?.extras?.result_codes as {
      transaction?: string;
      operations?: string[];
    }) ?? null
  );
}

// Submit a wallet-signed change_trust envelope. Returns a tagged outcome the hook maps to a state.
export async function submitSignedTransaction(
  signedXdr: string,
  networkPassphrase: string,
): Promise<SubmitOutcome> {
  if (!horizonIsHttps()) return { kind: 'failed', code: 'SUBMIT_FAILED' };
  const sdk = await loadStellarSdk();

  let tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction;
  try {
    tx = sdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch {
    return { kind: 'failed', code: 'SUBMIT_FAILED' };
  }

  // Pre-compute the hash so a network/timeout after submit can still be confirmed by hash. hash() is a
  // Uint8Array; hex-encode it by hand (no Buffer/encoding-arg dependency).
  const hash = Array.from(tx.hash() as Uint8Array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const server = new sdk.Horizon.Server(STELLAR_NETWORK.horizonUrl);

  try {
    const res = await server.submitTransaction(tx);
    return res.successful ? { kind: 'confirmed', hash: res.hash } : { kind: 'pending', hash };
  } catch (err) {
    const codes = readResultCodes(sdk, err);
    if (codes) {
      if (codes.transaction === 'tx_bad_seq') return { kind: 'rebuild', cause: 'tx_bad_seq' };
      if (codes.transaction === 'tx_too_late') return { kind: 'rebuild', cause: 'tx_too_late' };
      if (codes.transaction === 'tx_bad_auth') return { kind: 'accountMismatch' };
      if (codes.operations?.includes('change_trust_low_reserve')) return { kind: 'lowReserve' };
      if (codes.transaction === 'tx_insufficient_balance') return { kind: 'lowReserve' };
      return { kind: 'failed', code: 'SUBMIT_FAILED' };
    }
    // No typed result codes → network/timeout/unknown. The tx may still land; poll by hash.
    return { kind: 'pending', hash };
  }
}

// ── Confirm-poll (for the 'pending' path) ──
export type PollOutcome = 'confirmed' | 'pending' | 'failed';

// Look up a submitted tx by hash. 404 (not yet in a ledger) or transient error → 'pending' (keep polling
// within the hook's budget); a found-but-unsuccessful record → 'failed'.
export async function pollTransaction(hash: string): Promise<PollOutcome> {
  try {
    const sdk = await loadStellarSdk();
    const server = new sdk.Horizon.Server(STELLAR_NETWORK.horizonUrl);
    const record = await server.transactions().transaction(hash).call();
    return record.successful ? 'confirmed' : 'failed';
  } catch {
    // 404 (not yet in a ledger) or a transient error → keep polling within the hook's budget.
    return 'pending';
  }
}
