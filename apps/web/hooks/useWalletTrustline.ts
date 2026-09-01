'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProviderId,
  WalletProvider,
  WalletErrorCode,
  StellarAsset,
  TrustlineErrorCode,
  TrustlineRecovery,
  WalletTrustlineState,
} from '@/lib/types/api';
import { PLATFORM_USDC, STELLAR_NETWORK } from '@/lib/constants';
import { TRUSTLINE_MESSAGES } from '@/lib/wallet/trustlineMessages';
import {
  loadAccountState,
  buildChangeTrustXdr,
  submitSignedTransaction,
  pollTransaction,
  trustlineReserveShortfall,
  stroopsToXlm,
} from '@/lib/stellar/trustline';

// Lazy-import the signing wrappers — keeps each wallet SDK out of the initial bundle (mirrors useWalletAdd).
async function loadProvider(id: ProviderId): Promise<WalletProvider> {
  if (id === 'freighter') {
    const { freighterProvider } = await import('@/lib/wallet/freighter');
    return freighterProvider;
  }
  const { albedoProvider } = await import('@/lib/wallet/albedo');
  return albedoProvider;
}

// Map a wallet-wrapper error to a trustline code. never-guarded so a new WalletErrorCode is a compile
// error here (mirrors the service Record<Union, boolean> classifiers).
function fromWalletError(code: WalletErrorCode): TrustlineErrorCode {
  switch (code) {
    case 'EXTENSION_NOT_FOUND':
      return 'WALLET_NOT_INSTALLED';
    case 'POPUP_BLOCKED':
      return 'POPUP_BLOCKED';
    case 'USER_CANCELLED':
      return 'USER_CANCELLED';
    case 'NETWORK_MISMATCH':
      return 'NETWORK_MISMATCH';
    case 'AUTH_CHALLENGE_EXPIRED':
    case 'AUTH_SIGNATURE_INVALID':
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
      return 'SUBMIT_FAILED';
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

// What the dialog offers per error code. never-guarded (a new TrustlineErrorCode must be classified).
function trustlineRecovery(code: TrustlineErrorCode): TrustlineRecovery {
  switch (code) {
    case 'USER_CANCELLED':
    case 'POPUP_BLOCKED':
    case 'WALLET_NOT_INSTALLED':
    case 'SUBMIT_FAILED': // transient wallet/Horizon submit failure → re-attempt the sign+submit
      return 'retry-sign';
    case 'ACCOUNT_MISMATCH':
    case 'NETWORK_MISMATCH':
    case 'UNFUNDED':
    case 'HORIZON_UNAVAILABLE':
    case 'CONFIRMATION_PENDING':
    case 'ISSUER_UNCONFIGURED':
      return 'recheck';
    case 'ISSUER_MISMATCH':
    case 'REBUILD_EXHAUSTED':
      return 'terminal';
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

const MAX_REBUILDS = 2; // tx_bad_seq / tx_too_late rebuild+re-sign attempts
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 10; // 10 × 2s = 20s, comfortably under the 120s timebound

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Orchestrates the client-side change_trust ceremony for a bound BYOW wallet: pick provider → gate
// (active account == bound, asset pinned to the env issuer) → precheck funding → build → sign → submit →
// (confirm-poll / rebuild-on-bad-seq). Reused by the bind-success prompt and the settings-row CTA.
// `params.asset` is the asset to trust (bind response's asset, or PLATFORM_USDC for the CTA) — we always
// re-pin it to PLATFORM_USDC before signing (security: the env issuer is the trust anchor, not the
// backend-supplied one).
export function useWalletTrustline(params: {
  address: string;
  asset: StellarAsset;
  pollIntervalMs?: number;
}) {
  const { address, asset } = params;
  const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const [state, setState] = useState<WalletTrustlineState>({ status: 'idle' });
  const stateRef = useRef<WalletTrustlineState>(state);
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);
  const providerRef = useRef<WalletProvider | null>(null);
  const providerIdRef = useRef<ProviderId | null>(null); // last selected provider, for retry()
  const sequenceRef = useRef<string | null>(null); // reused for the first build (no N+1 re-fetch)
  const anchorRef = useRef<StellarAsset | null>(null); // pinned asset, so retry() can re-sign from error

  const setStateAndRef = useCallback((next: WalletTrustlineState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const toError = useCallback(
    (code: TrustlineErrorCode) => {
      setStateAndRef({
        status: 'error',
        code,
        message: TRUSTLINE_MESSAGES[code],
        recovery: trustlineRecovery(code),
      });
    },
    [setStateAndRef],
  );

  // The env-configured USDC asset is the trust anchor. Returns the pinned asset or a blockedGate reason.
  const pinnedAsset = useCallback((): { ok: true; asset: StellarAsset } | { ok: false } => {
    const issuer = PLATFORM_USDC.issuer;
    if (!issuer) {
      setStateAndRef({
        status: 'blockedGate',
        code: 'ISSUER_UNCONFIGURED',
        message: TRUSTLINE_MESSAGES.ISSUER_UNCONFIGURED,
      });
      return { ok: false };
    }
    if (asset.issuer !== issuer || asset.code !== PLATFORM_USDC.code) {
      setStateAndRef({
        status: 'blockedGate',
        code: 'ISSUER_MISMATCH',
        message: TRUSTLINE_MESSAGES.ISSUER_MISMATCH,
      });
      return { ok: false };
    }
    return { ok: true, asset: { code: PLATFORM_USDC.code, issuer } };
  }, [asset, setStateAndRef]);

  // Read the account and land in blockedUnfunded / blockedLowReserve / readyToSign / success (already
  // trusts) / error. Stores the fresh sequence for the build. Shared by start() and recheck().
  const runPrecheck = useCallback(
    async (anchor: StellarAsset) => {
      setStateAndRef({ status: 'prechecking' });
      const account = await loadAccountState(address, anchor);
      if (cancelledRef.current) return;

      if (account.status === 'unfunded') {
        setStateAndRef({ status: 'blockedUnfunded', address });
        return;
      }
      if (account.status === 'horizonUnavailable') {
        toError('HORIZON_UNAVAILABLE');
        return;
      }
      if (account.usdcLine === 'active') {
        // Already trusts USDC (fail-open no-op case) — nothing to sign, no tx, so no hash.
        setStateAndRef({ status: 'success' });
        return;
      }
      const shortfall = trustlineReserveShortfall({
        nativeBalance: account.nativeBalance,
        subentryCount: account.subentryCount,
        sellingLiabilities: account.sellingLiabilities,
      });
      if (shortfall > BigInt(0)) {
        setStateAndRef({ status: 'blockedLowReserve', shortfallXlm: stroopsToXlm(shortfall) });
        return;
      }
      sequenceRef.current = account.sequence;
      anchorRef.current = anchor;
      setStateAndRef({ status: 'readyToSign', asset: anchor });
    },
    [address, setStateAndRef, toError],
  );

  // Entry point: select a wallet, gate (active-account == bound, asset pinned), then precheck.
  const start = useCallback(
    async (id: ProviderId) => {
      if (busyRef.current) return;
      busyRef.current = true;
      providerIdRef.current = id;
      try {
        setStateAndRef({ status: 'gating' });

        const pinned = pinnedAsset();
        if (!pinned.ok) return;

        const provider = await loadProvider(id);
        if (cancelledRef.current) return;
        providerRef.current = provider;

        const pk = await provider.getPublicKey();
        if (cancelledRef.current) return;
        if (pk.status === 'error') {
          if (pk.code === 'USER_CANCELLED') {
            setStateAndRef({ status: 'idle' });
            return;
          }
          toError(fromWalletError(pk.code));
          return;
        }
        if (pk.data !== address) {
          setStateAndRef({
            status: 'blockedGate',
            code: 'ACCOUNT_MISMATCH',
            message: TRUSTLINE_MESSAGES.ACCOUNT_MISMATCH,
          });
          return;
        }

        await runPrecheck(pinned.asset);
      } finally {
        busyRef.current = false;
      }
    },
    [address, runPrecheck, pinnedAsset, toError, setStateAndRef],
  );

  // Poll a submitted tx by hash until confirmed or the budget is exhausted (CONFIRMATION_PENDING).
  const runPoll = useCallback(
    async (hash: string) => {
      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
        setStateAndRef({ status: 'polling', hash, attempt });
        const outcome = await pollTransaction(hash);
        if (cancelledRef.current) return;
        if (outcome === 'confirmed') {
          setStateAndRef({ status: 'success', hash });
          return;
        }
        if (outcome === 'failed') {
          toError('SUBMIT_FAILED');
          return;
        }
        await delay(pollIntervalMs);
        if (cancelledRef.current) return;
      }
      toError('CONFIRMATION_PENDING');
    },
    [pollIntervalMs, setStateAndRef, toError],
  );

  // Build → sign → submit, with bounded rebuild-and-resign on tx_bad_seq / tx_too_late. Must fire from a
  // user gesture (the wallet popup is gesture-gated). Precondition: readyToSign, provider + sequence set.
  const sign = useCallback(async () => {
    if (busyRef.current) return;
    // Guard on refs (not state) so retry() can re-drive sign() from an error-with-retry-sign state, not
    // only from readyToSign. All three are set once precheck reaches readyToSign.
    const provider = providerRef.current;
    const anchor = anchorRef.current;
    const seq = sequenceRef.current;
    if (!provider || !anchor || !seq) return;
    busyRef.current = true;
    const passphrase = STELLAR_NETWORK.passphrase;
    let sequence = seq;

    try {
      for (let attempt = 0; attempt <= MAX_REBUILDS; attempt++) {
        setStateAndRef({ status: 'signing' });

        let xdr: string;
        try {
          xdr = await buildChangeTrustXdr({
            accountId: address,
            sequence,
            asset: anchor,
            networkPassphrase: passphrase,
          });
        } catch {
          toError('SUBMIT_FAILED');
          return;
        }
        if (cancelledRef.current) return;

        const signed = await provider.signTransaction(xdr, passphrase);
        if (cancelledRef.current) return;
        if (signed.status === 'error') {
          if (signed.code === 'USER_CANCELLED') {
            setStateAndRef({ status: 'readyToSign', asset: anchor });
            return;
          }
          toError(fromWalletError(signed.code));
          return;
        }

        setStateAndRef({ status: 'submitting' });
        const outcome = await submitSignedTransaction(signed.data, passphrase);
        if (cancelledRef.current) return;

        if (outcome.kind === 'confirmed') {
          setStateAndRef({ status: 'success', hash: outcome.hash });
          return;
        }
        if (outcome.kind === 'failed') {
          toError(outcome.code);
          return;
        }
        if (outcome.kind === 'lowReserve') {
          // Re-derive funding state (fresh Horizon read) → blockedLowReserve / readyToSign.
          await runPrecheck(anchor);
          return;
        }
        if (outcome.kind === 'accountMismatch') {
          // tx_bad_auth: the wallet signed with a different active account than the bound source.
          setStateAndRef({
            status: 'blockedGate',
            code: 'ACCOUNT_MISMATCH',
            message: TRUSTLINE_MESSAGES.ACCOUNT_MISMATCH,
          });
          return;
        }
        if (outcome.kind === 'pending') {
          await runPoll(outcome.hash);
          return;
        }
        // outcome.kind === 'rebuild' — stale sequence / expired: re-fetch, rebuild, re-sign (bounded).
        if (attempt >= MAX_REBUILDS) {
          toError('REBUILD_EXHAUSTED');
          return;
        }
        const refreshed = await loadAccountState(address, anchor);
        if (cancelledRef.current) return;
        if (refreshed.status !== 'funded') {
          toError(refreshed.status === 'unfunded' ? 'UNFUNDED' : 'HORIZON_UNAVAILABLE');
          return;
        }
        sequence = refreshed.sequence;
      }
    } finally {
      busyRef.current = false;
    }
  }, [address, runPrecheck, runPoll, toError, setStateAndRef]);

  // Re-run the funding precheck (after the user funds / on a transient failure). Requires a provider
  // already selected (start() ran).
  const recheck = useCallback(async () => {
    if (busyRef.current || !providerRef.current) return;
    busyRef.current = true;
    try {
      const pinned = pinnedAsset();
      if (!pinned.ok) return;
      await runPrecheck(pinned.asset);
    } finally {
      busyRef.current = false;
    }
  }, [runPrecheck, pinnedAsset]);

  // Retry after a 'retry-sign' error: re-drive sign() if we're past precheck (provider + sequence +
  // anchor set), else re-run the whole gate from the last provider (gate-stage failure, no sequence yet).
  // Wired to the dialog's 'retry-sign' recovery so the "Try again" button is never inert.
  const retry = useCallback(async () => {
    if (busyRef.current) return;
    if (providerRef.current && sequenceRef.current && anchorRef.current) {
      await sign();
    } else if (providerIdRef.current) {
      await start(providerIdRef.current);
    }
  }, [sign, start]);

  const reset = useCallback(() => {
    busyRef.current = false;
    cancelledRef.current = false;
    providerRef.current = null;
    providerIdRef.current = null;
    sequenceRef.current = null;
    anchorRef.current = null;
    setStateAndRef({ status: 'idle' });
  }, [setStateAndRef]);

  return { state, start, sign, recheck, retry, reset } as const;
}
