'use client';

import { useEffect, useRef } from 'react';
import { useWalletTrustline } from '@/hooks/useWalletTrustline';
import { WALLET_PROVIDERS } from '@/lib/wallet/providers';
import { truncateAddress } from '@/lib/wallet/format';
import {
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SECONDARY_BUTTON_CLASS,
} from '@/components/auth/constants';
import type { StellarAsset, WalletSummary, WalletTrustlineState } from '@/lib/types/api';

interface Props {
  wallet: WalletSummary;
  // Asset to trust: the bind response's asset (bind path) or PLATFORM_USDC (settings CTA). The hook
  // re-pins it to the env issuer before signing.
  asset: StellarAsset;
  // Trustline confirmed on-chain — parent toasts + refreshes (badge re-derives). `added` is false for the
  // already-trusts no-op (nothing was submitted) so the parent can pick truthful copy.
  onDone: (added: boolean) => void;
  // "Skip for now" / dismiss without adding — parent closes + refreshes (no toast). The wallet keeps its
  // "USDC trustline needed" badge (re-derived from Horizon).
  onSkip: () => void;
}

// States where the flow can't be dismissed and focus belongs to the wallet popup / a spinner.
const LOCKED = new Set<WalletTrustlineState['status']>([
  'gating',
  'prechecking',
  'signing',
  'submitting',
  'polling',
]);

function liveCopy(state: WalletTrustlineState): string {
  switch (state.status) {
    case 'gating':
      return 'Checking your wallet…';
    case 'prechecking':
      return 'Checking your wallet balance…';
    case 'signing':
      return 'Approve the request in your wallet…';
    case 'submitting':
      return 'Adding the USDC trustline…';
    case 'polling':
      return 'Confirming on the Stellar network…';
    case 'success':
      return 'Your wallet can now receive USDC.';
    case 'error':
    case 'blockedGate':
      return state.message;
    default:
      // idle / readyToSign / blockedUnfunded / blockedLowReserve render their own visible copy; the
      // aria-live region is intentionally empty for them (no transient status to announce).
      return '';
  }
}

export default function WalletTrustlineDialog({ wallet, asset, onDone, onSkip }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { state, start, sign, recheck, retry, reset } = useWalletTrustline({
    address: wallet.address,
    asset,
  });

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Move focus to the heading on non-locked states (not the transient spinner states).
  useEffect(() => {
    if (!LOCKED.has(state.status)) headingRef.current?.focus();
  }, [state.status]);

  const locked = LOCKED.has(state.status);

  function handleSkip() {
    if (locked) return;
    dialogRef.current?.close();
    onSkip();
  }

  function handleDone() {
    if (state.status !== 'success') return; // guard (mirrors WalletAddDialog); Done only renders on success
    const added = Boolean(state.hash); // false for the already-trusts no-op (no tx, no hash)
    reset();
    dialogRef.current?.close();
    onDone(added);
  }

  const providerButtons = (
    <>
      {WALLET_PROVIDERS.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className={AUTH_SECONDARY_BUTTON_CLASS}
          onClick={() => start(provider.id)}
        >
          {provider.name}
        </button>
      ))}
    </>
  );

  const skipButton = (
    <button type="button" className={AUTH_SECONDARY_BUTTON_CLASS} onClick={handleSkip}>
      Skip for now
    </button>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="wallet-trustline-heading"
      onCancel={(e) => {
        if (locked) e.preventDefault();
        else handleSkip();
      }}
      className="m-auto w-full max-w-md rounded-md border border-white/10 bg-charcoal p-6 text-white backdrop:bg-ink/70"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {liveCopy(state)}
      </p>

      <h2
        id="wallet-trustline-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold outline-none"
      >
        Add USDC trustline
      </h2>

      {state.status === 'idle' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-white/70">
            Before <span className="font-mono">{truncateAddress(wallet.address)}</span> can receive
            USDC, it needs a one-time USDC trustline. Approve it in your wallet — it costs a small
            amount of XLM in reserve.
          </p>
          {providerButtons}
          {skipButton}
        </div>
      )}

      {locked && <p className="mt-4 text-sm text-white/70">{liveCopy(state)}</p>}

      {state.status === 'blockedGate' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-rose-ash" role="alert">
            {state.message}
          </p>
          {providerButtons}
          {skipButton}
        </div>
      )}

      {state.status === 'blockedUnfunded' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-white/70">
            This wallet has never been funded. Send a little XLM to{' '}
            <span className="font-mono">{truncateAddress(wallet.address)}</span> first, then
            recheck.
          </p>
          <button type="button" className={AUTH_PRIMARY_BUTTON_CLASS} onClick={recheck}>
            I&rsquo;ve funded it — recheck
          </button>
          {skipButton}
        </div>
      )}

      {state.status === 'blockedLowReserve' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-white/70">
            Your wallet needs about {state.shortfallXlm} more XLM to add the USDC trustline. Top it
            up, then recheck.
          </p>
          <button type="button" className={AUTH_PRIMARY_BUTTON_CLASS} onClick={recheck}>
            I&rsquo;ve topped up — recheck
          </button>
          {skipButton}
        </div>
      )}

      {state.status === 'readyToSign' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-white/70">
            Approve the USDC trustline in your wallet to finish.
          </p>
          <button type="button" className={AUTH_PRIMARY_BUTTON_CLASS} onClick={sign}>
            Add USDC trustline
          </button>
          {skipButton}
        </div>
      )}

      {state.status === 'success' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-white/70">Your wallet can now receive USDC.</p>
          <button type="button" className={AUTH_PRIMARY_BUTTON_CLASS} onClick={handleDone}>
            Done
          </button>
        </div>
      )}

      {state.status === 'error' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-rose-ash" role="alert">
            {state.message}
          </p>
          {state.recovery === 'retry-sign' && (
            <button type="button" className={AUTH_PRIMARY_BUTTON_CLASS} onClick={retry}>
              Try again
            </button>
          )}
          {state.recovery === 'recheck' && (
            <button type="button" className={AUTH_PRIMARY_BUTTON_CLASS} onClick={recheck}>
              Recheck
            </button>
          )}
          {skipButton}
        </div>
      )}
    </dialog>
  );
}
