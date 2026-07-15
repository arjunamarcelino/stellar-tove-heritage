'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProviderId,
  WalletProvider,
  WalletAddState,
  WalletAddRecovery,
  AddWalletErrorCode,
} from '@/lib/types/api';
import { ADD_WALLET_MESSAGES } from '@/lib/wallet/manageMessages';
import { addWalletChallengeAction, addWalletAction } from '@/app/actions/walletManage';

// Lazy-import the real signing wrappers (keeps each wallet SDK out of the initial bundle) — mirrors
// useWalletConnect. lib/wallet/providers.ts is only a metadata registry; the wrappers live in
// freighter.ts / albedo.ts and never throw (they return a discriminated WalletResult).
async function loadProvider(id: ProviderId): Promise<WalletProvider> {
  if (id === 'freighter') {
    const { freighterProvider } = await import('@/lib/wallet/freighter');
    return freighterProvider;
  }
  const { albedoProvider } = await import('@/lib/wallet/albedo');
  return albedoProvider;
}

// Recovery classification, inline (no separate Record) — mirrors useWalletExport's inline branching.
function addRecovery(code: AddWalletErrorCode): WalletAddRecovery {
  switch (code) {
    case 'IDEMPOTENCY_KEY_IN_FLIGHT': // 409 in-flight — resubmit the same key + body
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'SERVER_ERROR':
      return 'retry-send';
    case 'WALLET_ALREADY_BOUND':
    case 'SESSION_EXPIRED':
      return 'terminal';
    case 'VALIDATION_FAILED':
    case 'AUTH_SIGNATURE_INVALID':
    case 'AUTH_CHALLENGE_NOT_FOUND':
    case 'AUTH_CHALLENGE_EXPIRED':
    case 'AUTH_CHALLENGE_ALREADY_USED':
    case 'IDEMPOTENCY_KEY_MISMATCH': // need a fresh challenge + key
      return 'restart';
    default: {
      // Exhaustiveness guard: a new AddWalletErrorCode must be classified here (compile error) rather
      // than silently defaulting to 'restart' — mirrors the Record<Union, boolean> service classifiers.
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

// Orchestrates the 2-step SEP-10 add ceremony: pick provider → getPublicKey → challenge → sign →
// submit. Never mints a session or redirects (unlike the login-connect flow). The idempotency key is
// bound to one signed body: minted once at sign time, reused only for a transport-retry of the
// identical body, regenerated on any restart (new challenge).
export function useWalletAdd() {
  const [state, setState] = useState<WalletAddState>({ status: 'idle' });
  const stateRef = useRef<WalletAddState>(state);
  const busyRef = useRef(false); // serializes entry points → no concurrent submits (double-click safe)
  const cancelledRef = useRef(false); // set on unmount → suppress post-unmount state updates
  const providerRef = useRef<WalletProvider | null>(null);
  const signedBodyRef = useRef<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  function setStateAndRef(next: WalletAddState) {
    stateRef.current = next;
    setState(next);
  }

  // The hook owns its own unmount guard (mirrors useWalletExport) so cancellation holds regardless of
  // which component mounts it — no reliance on a consumer calling a cleanup fn.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const selectProvider = useCallback(async (id: ProviderId) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      setStateAndRef({ status: 'connecting' });

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
        setStateAndRef({ status: 'error', message: pk.message, recovery: 'restart' });
        return;
      }

      setStateAndRef({ status: 'challenging' });
      const challenge = await addWalletChallengeAction(pk.data);
      if (cancelledRef.current) return;
      if (challenge.status === 'error') {
        setStateAndRef({
          status: 'error',
          message: challenge.message,
          recovery: addRecovery(challenge.code),
        });
        return;
      }

      setStateAndRef({
        status: 'readyToSign',
        challengeTxXdr: challenge.challengeTxXdr,
        networkPassphrase: challenge.networkPassphrase,
      });
    } finally {
      busyRef.current = false;
    }
  }, []);

  // POST /me/wallets with the current signed body + key. Shared by sign() and retrySend(); callers
  // own the busyRef guard. Checks cancelledRef after the await (unmount-during-submit safety).
  const submit = useCallback(async (body: string, key: string) => {
    setStateAndRef({ status: 'submitting' });
    const result = await addWalletAction(body, key);
    if (cancelledRef.current) return;
    if (result.status === 'error') {
      setStateAndRef({
        status: 'error',
        message: result.message,
        recovery: addRecovery(result.code),
      });
      return;
    }
    setStateAndRef({ status: 'success', wallet: result.wallet });
  }, []);

  const sign = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'readyToSign' || !providerRef.current) return;
    if (busyRef.current) return;
    busyRef.current = true;
    const { challengeTxXdr, networkPassphrase } = current;
    try {
      setStateAndRef({ status: 'signing' });

      const signed = await providerRef.current.signTransaction(challengeTxXdr, networkPassphrase);
      if (cancelledRef.current) return;
      if (signed.status === 'error') {
        if (signed.code === 'USER_CANCELLED') {
          setStateAndRef({ status: 'readyToSign', challengeTxXdr, networkPassphrase });
          return;
        }
        setStateAndRef({ status: 'error', message: signed.message, recovery: 'restart' });
        return;
      }

      // Mint the key once, bound to this signed body. crypto.randomUUID() throws outside a secure
      // context → surface as an error rather than leaving the machine stuck in 'signing'. The try wraps
      // ONLY the mint; signedBodyRef is set after a successful mint so a throw never leaves a stored
      // body with no key.
      let key: string;
      try {
        idempotencyKeyRef.current ??= crypto.randomUUID();
        key = idempotencyKeyRef.current;
      } catch {
        setStateAndRef({
          status: 'error',
          message: ADD_WALLET_MESSAGES.SERVER_ERROR,
          recovery: 'restart',
        });
        return;
      }
      signedBodyRef.current = signed.data;

      await submit(signed.data, key);
    } finally {
      busyRef.current = false;
    }
  }, [submit]);

  // Retry-send: resubmit the SAME signed body + SAME key (transient/in-flight failures). The busyRef
  // guard means a double-click can't fire a second concurrent POST — the in-flight one keeps running.
  const retrySend = useCallback(async () => {
    if (busyRef.current) return;
    const body = signedBodyRef.current;
    const key = idempotencyKeyRef.current;
    if (!body || !key) return;
    busyRef.current = true;
    try {
      await submit(body, key);
    } finally {
      busyRef.current = false;
    }
  }, [submit]);

  // Restart: discard the signed body + key so the next attempt fetches a fresh challenge and mints a
  // fresh key (prevents the same-key/different-body 422).
  const reset = useCallback(() => {
    busyRef.current = false;
    cancelledRef.current = false;
    providerRef.current = null;
    signedBodyRef.current = null;
    idempotencyKeyRef.current = null;
    setStateAndRef({ status: 'idle' });
  }, []);

  return { state, selectProvider, sign, retrySend, reset } as const;
}
