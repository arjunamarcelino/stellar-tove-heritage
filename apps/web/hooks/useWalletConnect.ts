'use client';

import { useState, useCallback, useRef } from 'react';
import type { WalletConnectState, WalletProvider, ProviderId } from '@/lib/types/api';
import { requestChallengeAction, walletVerifyAction } from '@/app/actions/wallet';

async function loadProvider(id: ProviderId): Promise<WalletProvider> {
  if (id === 'freighter') {
    const { freighterProvider } = await import('@/lib/wallet/freighter');
    return freighterProvider;
  }
  const { albedoProvider } = await import('@/lib/wallet/albedo');
  return albedoProvider;
}

export function useWalletConnect() {
  const [state, setState] = useState<WalletConnectState>({ status: 'idle' });
  const [providerId, setProviderId] = useState<ProviderId | 'manual' | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const providerRef = useRef<WalletProvider | null>(null);
  const stateRef = useRef<WalletConnectState>(state);
  const busyRef = useRef(false);

  function setStateAndRef(next: WalletConnectState) {
    stateRef.current = next;
    setState(next);
  }

  const selectProvider = useCallback(async (id: ProviderId) => {
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      setProviderId(id);
      setStateAndRef({ status: 'loading' });

      const provider = await loadProvider(id);
      providerRef.current = provider;

      const pkResult = await provider.getPublicKey();
      if (pkResult.status === 'error') {
        if (pkResult.code === 'USER_CANCELLED') {
          setStateAndRef({ status: 'idle' });
          setProviderId(null);
          return;
        }
        setStateAndRef({
          status: 'error',
          code: pkResult.code,
          message: pkResult.message,
          retryable: pkResult.code !== 'EXTENSION_NOT_FOUND',
        });
        return;
      }

      setPublicKey(pkResult.data);
      const challengeResult = await requestChallengeAction(pkResult.data);
      if (challengeResult.status === 'error') {
        setStateAndRef({
          status: 'error',
          code: challengeResult.code,
          message: challengeResult.message,
          retryable: true,
        });
        return;
      }

      setStateAndRef({
        status: 'signing',
        xdr: challengeResult.xdr,
        networkPassphrase: challengeResult.networkPassphrase,
      });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const sign = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'signing' || !providerRef.current) return;
    if (busyRef.current) return;
    busyRef.current = true;

    const { xdr, networkPassphrase } = current;

    try {
      setStateAndRef({ status: 'loading' });

      const signResult = await providerRef.current.signTransaction(
        xdr,
        networkPassphrase,
      );

      if (signResult.status === 'error') {
        if (signResult.code === 'USER_CANCELLED') {
          setStateAndRef({ status: 'signing', xdr, networkPassphrase });
          return;
        }
        setStateAndRef({
          status: 'error',
          code: signResult.code,
          message: signResult.message,
          retryable: true,
        });
        return;
      }

      const verifyResult = await walletVerifyAction(signResult.data);
      if (verifyResult.status === 'error') {
        setStateAndRef({
          status: 'error',
          code: verifyResult.code,
          message: verifyResult.message,
          retryable: verifyResult.code === 'AUTH_CHALLENGE_EXPIRED',
        });
      }
    } finally {
      busyRef.current = false;
    }
  }, []);

  const requestManualChallenge = useCallback(async (pk: string) => {
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      setProviderId('manual');
      setPublicKey(pk);
      setStateAndRef({ status: 'loading' });

      const challengeResult = await requestChallengeAction(pk);
      if (challengeResult.status === 'error') {
        setStateAndRef({
          status: 'error',
          code: challengeResult.code,
          message: challengeResult.message,
          retryable: true,
        });
        return;
      }

      setStateAndRef({
        status: 'signing',
        xdr: challengeResult.xdr,
        networkPassphrase: challengeResult.networkPassphrase,
      });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const verifyManualXdr = useCallback(async (signedXdr: string) => {
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      setStateAndRef({ status: 'loading' });

      const verifyResult = await walletVerifyAction(signedXdr);
      if (verifyResult.status === 'error') {
        setStateAndRef({
          status: 'error',
          code: verifyResult.code,
          message: verifyResult.message,
          retryable: verifyResult.code === 'AUTH_CHALLENGE_EXPIRED',
        });
      }
    } finally {
      busyRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    busyRef.current = false;
    setStateAndRef({ status: 'idle' });
    setProviderId(null);
    setPublicKey(null);
    providerRef.current = null;
  }, []);

  return {
    state,
    providerId,
    publicKey,
    selectProvider,
    sign,
    requestManualChallenge,
    verifyManualXdr,
    reset,
  } as const;
}
