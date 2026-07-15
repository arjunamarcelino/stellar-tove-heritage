'use client';

import { useEffect, useRef } from 'react';
import { useWalletAdd } from '@/hooks/useWalletAdd';
import { WALLET_PROVIDERS } from '@/lib/wallet/providers';
import {
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SECONDARY_BUTTON_CLASS,
} from '@/components/auth/constants';
import type { WalletAddState } from '@/lib/types/api';

interface Props {
  // Success — the parent refreshes the list and closes the dialog, restoring focus to a stable element.
  onAdded: () => void;
  // Cancel/close without adding — parent closes and restores focus to the trigger.
  onClose: () => void;
}

// In-flight statuses where the flow can't be dismissed and focus belongs to the provider popup / a
// spinner (not the dialog heading).
const IN_FLIGHT = new Set<WalletAddState['status']>([
  'connecting',
  'challenging',
  'signing',
  'submitting',
]);

function liveCopy(state: WalletAddState): string {
  switch (state.status) {
    case 'connecting':
      return 'Connecting your wallet…';
    case 'challenging':
      return 'Preparing a secure request…';
    case 'signing':
      return 'Approve the request in your wallet…';
    case 'submitting':
      return 'Adding your wallet…';
    case 'success':
      return 'Wallet added.';
    case 'error':
      return state.message;
    default:
      return '';
  }
}

export default function WalletAddDialog({ onAdded, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { state, selectProvider, sign, retrySend, reset } = useWalletAdd();

  // Open the modal. The hook owns its own unmount guard, so no cleanup call is needed here. No
  // provider popup fires here — it must come from a user click (Safari blocks non-gesture popups).
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Move focus to the heading only on interactive/terminal states — not the transient spinner states,
  // where focus belongs to the provider popup.
  useEffect(() => {
    if (!IN_FLIGHT.has(state.status)) headingRef.current?.focus();
  }, [state.status]);

  const inFlight = IN_FLIGHT.has(state.status);

  function handleClose() {
    if (inFlight) return;
    dialogRef.current?.close();
    onClose();
  }

  function handleDone() {
    dialogRef.current?.close();
    onAdded();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="wallet-add-heading"
      onCancel={(e) => {
        if (inFlight) e.preventDefault();
        else handleClose();
      }}
      className="m-auto w-full max-w-md rounded-md border border-white/10 bg-charcoal p-6 text-white backdrop:bg-ink/70"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {liveCopy(state)}
      </p>

      <h2
        id="wallet-add-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold outline-none"
      >
        Add a wallet
      </h2>

      {state.status === 'idle' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-white/70">
            Connect an external Stellar wallet to link it to your account.
          </p>
          {WALLET_PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={AUTH_SECONDARY_BUTTON_CLASS}
              onClick={() => selectProvider(provider.id)}
            >
              {provider.name}
            </button>
          ))}
          <button type="button" className={AUTH_SECONDARY_BUTTON_CLASS} onClick={handleClose}>
            Cancel
          </button>
        </div>
      )}

      {inFlight && <p className="mt-4 text-sm text-white/70">{liveCopy(state)}</p>}

      {state.status === 'readyToSign' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-white/70">
            Approve the signature request in your wallet to finish linking it.
          </p>
          <button type="button" className={AUTH_PRIMARY_BUTTON_CLASS} onClick={sign}>
            Sign &amp; add wallet
          </button>
          <button type="button" className={AUTH_SECONDARY_BUTTON_CLASS} onClick={handleClose}>
            Cancel
          </button>
        </div>
      )}

      {state.status === 'success' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-white/70">Your wallet is now linked to your account.</p>
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
          {state.recovery === 'retry-send' && (
            <button type="button" className={AUTH_PRIMARY_BUTTON_CLASS} onClick={retrySend}>
              Try again
            </button>
          )}
          {state.recovery === 'restart' && (
            <button type="button" className={AUTH_PRIMARY_BUTTON_CLASS} onClick={reset}>
              Start over
            </button>
          )}
          <button type="button" className={AUTH_SECONDARY_BUTTON_CLASS} onClick={handleClose}>
            Close
          </button>
        </div>
      )}
    </dialog>
  );
}
