'use client';

import { useRef, useEffect, useId, useState } from 'react';
import type { WalletConnectState, WalletErrorCode, ProviderId } from '@/lib/types/api';
import { WALLET_PROVIDERS } from '@/lib/wallet/providers';
import Spinner from '@/components/ui/Spinner';
import ManualXdrForm from './ManualXdrForm';

interface WalletConnectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  state: WalletConnectState;
  providerId: ProviderId | 'manual' | null;
  publicKey: string | null;
  onSelectProvider: (id: ProviderId) => Promise<void>;
  onSign: () => Promise<void>;
  onRequestManualChallenge: (publicKey: string) => Promise<void>;
  onVerifyManualXdr: (signedXdr: string) => Promise<void>;
  onReset: () => void;
}

function getErrorMessage(code: WalletErrorCode, message: string): string {
  switch (code) {
    case 'EXTENSION_NOT_FOUND':
      return message;
    case 'POPUP_BLOCKED':
      return 'Popup was blocked by your browser. Please allow popups for this site and try again.';
    case 'AUTH_CHALLENGE_EXPIRED':
      return 'The challenge expired. Please try again.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return message;
  }
}

export default function WalletConnectDialog({
  isOpen,
  onClose,
  state,
  providerId,
  publicKey,
  onSelectProvider,
  onSign,
  onRequestManualChallenge,
  onVerifyManualXdr,
  onReset,
}: WalletConnectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleClose() {
      setShowManual(false);
      onClose();
    }

    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const isLoading = state.status === 'loading';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="wallet-dialog m-auto w-full max-w-md rounded-2xl border border-parchment/10 bg-graphite p-0 text-parchment"
    >
      <div className="flex items-center justify-between border-b border-parchment/10 px-6 py-4">
        <h2 id={titleId} className="font-heading text-lg">
          Connect Wallet
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="flex h-8 w-8 items-center justify-center rounded-full text-parchment/60 transition-colors hover:bg-parchment/10 hover:text-parchment"
          aria-label="Close"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-6 py-5">
        {/* Error state */}
        {state.status === 'error' && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-300">
              {getErrorMessage(state.code, state.message)}
            </p>
            {state.code === 'EXTENSION_NOT_FOUND' &&
              (() => {
                const provider = WALLET_PROVIDERS.find((p) => p.id === providerId);
                return provider?.installUrl ? (
                  <a
                    href={provider.installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block font-body text-sm text-sienna underline hover:text-ochre"
                  >
                    Install {provider.name}
                  </a>
                ) : null;
              })()}
            {state.retryable && (
              <button
                type="button"
                onClick={onReset}
                className="mt-2 block font-body text-sm text-sienna underline hover:text-ochre"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {/* Signing state — show XDR + sign button */}
        {state.status === 'signing' && providerId !== 'manual' && (
          <div className="flex flex-col gap-4">
            <p className="font-body text-sm text-parchment/70">
              Review and sign the authentication challenge
              {publicKey && (
                <span className="mt-1 block font-mono text-xs text-parchment/50">
                  {publicKey.slice(0, 8)}...{publicKey.slice(-4)}
                </span>
              )}
            </p>
            <code className="block max-h-24 overflow-auto rounded-lg bg-ink/80 p-3 font-mono text-xs text-parchment/80 break-all">
              {state.xdr}
            </code>
            <button
              type="button"
              onClick={onSign}
              disabled={isLoading}
              className="rounded-lg bg-sienna px-4 py-2.5 font-body text-sm text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Sign Challenge
            </button>
          </div>
        )}

        {/* Signing state for manual — show ManualXdrForm verify step */}
        {state.status === 'signing' && providerId === 'manual' && (
          <ManualXdrForm
            xdr={state.xdr}
            onRequestChallenge={onRequestManualChallenge}
            onVerify={onVerifyManualXdr}
            disabled={isLoading}
          />
        )}

        {/* Loading state */}
        {state.status === 'loading' && (
          <div className="flex items-center justify-center py-8">
            <Spinner size="sm" className="border-parchment/20 border-t-sienna" />
          </div>
        )}

        {/* Idle state — wallet picker */}
        {state.status === 'idle' && !showManual && (
          <div className="flex flex-col gap-2">
            <p className="mb-2 font-body text-sm text-parchment/60">Choose a wallet to connect</p>
            {WALLET_PROVIDERS.map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                onClick={() => onSelectProvider(wallet.id)}
                disabled={isLoading}
                className="flex items-center gap-3 rounded-lg border border-parchment/10 px-4 py-3 text-left transition-colors hover:border-parchment/20 hover:bg-parchment/5 disabled:opacity-50"
              >
                <span className="font-body text-sm text-parchment">{wallet.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowManual(true)}
              disabled={isLoading}
              className="flex items-center gap-3 rounded-lg border border-parchment/10 px-4 py-3 text-left transition-colors hover:border-parchment/20 hover:bg-parchment/5 disabled:opacity-50"
            >
              <span className="font-body text-sm text-parchment">Other (paste XDR)</span>
            </button>
          </div>
        )}

        {/* Manual XDR — public key input step */}
        {state.status === 'idle' && showManual && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setShowManual(false)}
              className="self-start font-body text-xs text-parchment/50 hover:text-parchment/70"
            >
              &larr; Back to wallet list
            </button>
            <ManualXdrForm
              xdr={null}
              onRequestChallenge={onRequestManualChallenge}
              onVerify={onVerifyManualXdr}
              disabled={isLoading}
            />
          </div>
        )}
      </div>
    </dialog>
  );
}
