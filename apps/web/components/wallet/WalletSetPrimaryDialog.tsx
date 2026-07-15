'use client';

import { useEffect, useRef, useState } from 'react';
import { setPrimaryWalletAction } from '@/app/actions/walletManage';
import {
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SECONDARY_BUTTON_CLASS,
} from '@/components/auth/constants';
import { truncateAddress } from '@/lib/wallet/format';
import type { WalletSummary, SetPrimaryWalletErrorCode } from '@/lib/types/api';

interface Props {
  // The incoming wallet to promote.
  wallet: WalletSummary;
  // The outgoing primary (for the copy); may be undefined if the list has no known primary.
  currentPrimary?: WalletSummary;
  // A terminal, list-changing outcome — the parent closes the dialog, refreshes the list, and
  // restores focus. `didPromote` is true only on a genuine success (200), false on a stale-list race
  // (not-found / not-eligible / kind-unsupported / session-expired) so the parent announces success
  // only when the primary actually changed.
  onResolved: (didPromote: boolean) => void;
  // The user cancelled — parent closes and restores focus to the trigger.
  onClose: () => void;
}

// Codes where the list is now stale/changed, so a refresh corrects the UI (and SESSION_EXPIRED makes
// the settings server component redirect to /login on refresh). Every other error is transient and
// keeps the dialog open with a retry.
const RESOLVE_ON = new Set<SetPrimaryWalletErrorCode>([
  'WALLET_NOT_FOUND', // already gone — refresh drops the row
  'WALLET_NOT_ELIGIBLE_FOR_PRIMARY',
  'WALLET_KIND_NOT_SUPPORTED',
  'SESSION_EXPIRED',
]);

type LocalState = { status: 'idle' } | { status: 'setting' } | { status: 'error'; message: string };

// Set-primary is a neutral, reversible flip, so this uses the DEFAULT `dialog` role (not
// `alertdialog`, which WAI-ARIA APG reserves for destructive/error confirmations — the intentional
// divergence from the destructive WalletRemoveDialog). showModal() supplies the modal semantics.
// Success is announced by the parent panel's persistent live region, not here.
export default function WalletSetPrimaryDialog({
  wallet,
  currentPrimary,
  onResolved,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<LocalState>({ status: 'idle' });

  useEffect(() => {
    dialogRef.current?.showModal();
    cancelRef.current?.focus(); // autofocus the safe action
  }, []);

  const setting = state.status === 'setting';

  function handleClose() {
    if (setting) return;
    dialogRef.current?.close();
    onClose();
  }

  async function handleSetPrimary() {
    if (setting) return;
    setState({ status: 'setting' });
    const result = await setPrimaryWalletAction(wallet.id);
    if (result.status === 'success' || RESOLVE_ON.has(result.code)) {
      dialogRef.current?.close();
      onResolved(result.status === 'success');
      return;
    }
    setState({ status: 'error', message: result.message });
  }

  // Only the in-flight message goes to this polite status region; errors are announced by the
  // assertive role="alert" below (so the message isn't spoken twice).
  const liveMessage = state.status === 'setting' ? 'Setting primary wallet…' : '';

  const showOutgoing = currentPrimary && currentPrimary.id !== wallet.id;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="wallet-set-primary-heading"
      aria-describedby="wallet-set-primary-desc"
      onCancel={(e) => {
        if (setting) e.preventDefault();
        else handleClose();
      }}
      className="m-auto w-full max-w-md rounded-md border border-white/10 bg-charcoal p-6 text-white backdrop:bg-ink/70"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <h2 id="wallet-set-primary-heading" className="text-lg font-semibold">
        Set as primary wallet?
      </h2>
      <p id="wallet-set-primary-desc" className="mt-3 text-sm text-white/70">
        <span className="font-mono text-white/90">{truncateAddress(wallet.address)}</span> will
        become your account default for transactions.
        {showOutgoing && (
          <>
            {' '}
            <span className="font-mono text-white/90">
              {truncateAddress(currentPrimary.address)}
            </span>{' '}
            will no longer be your primary.
          </>
        )}
      </p>

      {state.status === 'error' && (
        <p className="mt-4 text-sm text-rose-ash" role="alert">
          {state.message}
        </p>
      )}

      <div className="mt-6 space-y-2">
        <button
          type="button"
          className={AUTH_PRIMARY_BUTTON_CLASS}
          onClick={handleSetPrimary}
          disabled={setting}
        >
          {setting ? 'Setting…' : state.status === 'error' ? 'Try again' : 'Set as primary'}
        </button>
        <button
          ref={cancelRef}
          type="button"
          className={AUTH_SECONDARY_BUTTON_CLASS}
          onClick={handleClose}
          disabled={setting}
        >
          Cancel
        </button>
      </div>
    </dialog>
  );
}
