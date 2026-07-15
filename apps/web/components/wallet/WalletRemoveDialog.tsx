'use client';

import { useEffect, useRef, useState } from 'react';
import { removeWalletAction } from '@/app/actions/walletManage';
import { WALLET_DESTRUCTIVE_BUTTON_CLASS } from '@/components/wallet/constants';
import { AUTH_SECONDARY_BUTTON_CLASS } from '@/components/auth/constants';
import { truncateAddress } from '@/lib/wallet/format';
import type { WalletSummary, RemoveWalletErrorCode } from '@/lib/types/api';

interface Props {
  wallet: WalletSummary;
  // A terminal, list-changing outcome (removed, already-gone, or a stale-list race) — the parent
  // closes the dialog, refreshes the list, and restores focus to a stable element.
  onResolved: () => void;
  // The user cancelled — parent closes and restores focus to the trigger.
  onClose: () => void;
}

// Codes where the list is now stale/changed, so a refresh corrects the UI (and SESSION_EXPIRED makes
// the settings server component redirect to /login on refresh). Every other error is transient and
// keeps the dialog open with a retry.
const RESOLVE_ON = new Set<RemoveWalletErrorCode>([
  'WALLET_NOT_FOUND', // already gone — refresh drops the row
  'PRIMARY_WALLET_CANNOT_BE_REMOVED',
  'WALLET_KIND_NOT_SUPPORTED',
  'SESSION_EXPIRED',
]);

type LocalState =
  | { status: 'idle' }
  | { status: 'removing' }
  | { status: 'error'; message: string };

// Removal is reversible (re-adding reactivates), so this is a light confirm — not the heavy typed
// confirmation the irreversible export flow uses. role="alertdialog" + autofocus Cancel per WAI-ARIA.
export default function WalletRemoveDialog({ wallet, onResolved, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<LocalState>({ status: 'idle' });

  useEffect(() => {
    dialogRef.current?.showModal();
    cancelRef.current?.focus(); // focus the least-destructive control
  }, []);

  const removing = state.status === 'removing';

  function handleClose() {
    if (removing) return;
    dialogRef.current?.close();
    onClose();
  }

  async function handleRemove() {
    if (removing) return;
    setState({ status: 'removing' });
    const result = await removeWalletAction(wallet.id);
    if (result.status === 'success' || RESOLVE_ON.has(result.code)) {
      dialogRef.current?.close();
      onResolved();
      return;
    }
    setState({ status: 'error', message: result.message });
  }

  // Only the in-flight message goes to this polite status region; errors are announced by the
  // assertive role="alert" below (so the message isn't spoken twice).
  const liveMessage = state.status === 'removing' ? 'Removing wallet…' : '';

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby="wallet-remove-heading"
      aria-describedby="wallet-remove-desc"
      onCancel={(e) => {
        if (removing) e.preventDefault();
        else handleClose();
      }}
      className="m-auto w-full max-w-md rounded-md border border-white/10 bg-charcoal p-6 text-white backdrop:bg-ink/70"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <h2 id="wallet-remove-heading" className="text-lg font-semibold">
        Remove this wallet?
      </h2>
      <p id="wallet-remove-desc" className="mt-3 text-sm text-white/70">
        <span className="font-mono text-white/90">{truncateAddress(wallet.address)}</span> will be
        unlinked from your account. You can reconnect it later.
      </p>

      {state.status === 'error' && (
        <p className="mt-4 text-sm text-rose-ash" role="alert">
          {state.message}
        </p>
      )}

      <div className="mt-6 space-y-2">
        <button
          type="button"
          className={WALLET_DESTRUCTIVE_BUTTON_CLASS}
          onClick={handleRemove}
          disabled={removing}
        >
          {removing ? 'Removing…' : state.status === 'error' ? 'Try again' : 'Remove wallet'}
        </button>
        <button
          ref={cancelRef}
          type="button"
          className={AUTH_SECONDARY_BUTTON_CLASS}
          onClick={handleClose}
          disabled={removing}
        >
          Cancel
        </button>
      </div>
    </dialog>
  );
}
