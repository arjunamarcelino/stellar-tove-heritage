'use client';

import { useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import WalletExportDialog from '@/components/wallet/WalletExportDialog';
import WalletRemoveDialog from '@/components/wallet/WalletRemoveDialog';
import WalletAddDialog from '@/components/wallet/WalletAddDialog';
import WalletSetPrimaryDialog from '@/components/wallet/WalletSetPrimaryDialog';
import WalletRow from '@/components/wallet/WalletRow';
import { AUTH_SECONDARY_BUTTON_CLASS } from '@/components/auth/constants';
import { truncateAddress } from '@/lib/wallet/format';
import type { WalletSummary } from '@/lib/types/api';

interface Props {
  wallets: WalletSummary[];
}

// Single-primary transform for the optimistic promote: flip isPrimary onto the promoted wallet and
// off every other, preserving the exactly-one-primary invariant. Pure (exported for unit tests).
export function promoteInList(wallets: WalletSummary[], promotedId: string): WalletSummary[] {
  return wallets.map((w) => ({ ...w, isPrimary: w.id === promotedId }));
}

export default function WalletSettingsPanel({ wallets }: Props) {
  const router = useRouter();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Optimistic view of the list so a promote moves the ★ badge immediately; router.refresh() then
  // re-reads authoritative state and useOptimistic reverts to the fresh prop once the transition settles.
  const [optimisticWallets, promoteOptimistic] = useOptimistic(wallets, promoteInList);
  const [exportingWallet, setExportingWallet] = useState<WalletSummary | null>(null);
  const [removingWallet, setRemovingWallet] = useState<WalletSummary | null>(null);
  const [settingPrimaryWallet, setSettingPrimaryWallet] = useState<WalletSummary | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [isPending, startTransition] = useTransition();

  // The current primary, passed to the set-primary dialog so its copy can name the outgoing wallet.
  const currentPrimary = optimisticWallets.find((w) => w.isPrimary);

  // After a mutation the triggering row may be gone, so native focus-return would fall to <body>.
  // Restore focus to the (always-present) Add-wallet button instead.
  function restoreFocus() {
    addButtonRef.current?.focus();
  }

  function handleRemoved() {
    setRemovingWallet(null);
    restoreFocus();
    startTransition(() => router.refresh());
  }

  function handleRemoveCancel() {
    setRemovingWallet(null);
    restoreFocus();
  }

  // The set-primary dialog resolves on a genuine promote AND on stale-list races; only announce when
  // the primary actually changed (didPromote). Either way, refresh so the badge move / correction shows.
  function handleSetPrimaryResolved(didPromote: boolean) {
    const promoted = settingPrimaryWallet;
    setSettingPrimaryWallet(null);
    restoreFocus();
    // A state assertion (not "updated") so it's truthful even on an idempotent no-op; naming the
    // wallet also makes the text differ between promotes so aria-live re-announces each one.
    if (didPromote && promoted) {
      setAnnouncement(`${truncateAddress(promoted.address)} is now your primary wallet.`);
    }
    startTransition(() => {
      // Optimistically move the badge (must be dispatched inside the transition); the refresh keeps
      // the transition pending until authoritative state lands, then the optimistic view reverts to it.
      if (didPromote && promoted) promoteOptimistic(promoted.id);
      router.refresh();
    });
  }

  function handleSetPrimaryCancel() {
    setSettingPrimaryWallet(null);
    restoreFocus();
  }

  function handleAdded() {
    setAddingOpen(false);
    restoreFocus();
    startTransition(() => router.refresh());
  }

  function handleAddClose() {
    setAddingOpen(false);
    restoreFocus();
  }

  // Export keeps its success screen open after onExported, so success only refreshes the list (in a
  // transition); focus is restored when the dialog is closed.
  function handleExported() {
    startTransition(() => router.refresh());
  }

  function handleExportClose() {
    setExportingWallet(null);
    restoreFocus();
  }

  return (
    <div className="space-y-4">
      {/* Persistent, always-mounted live region: a dialog-owned one would unmount on close before the
          announcement lands. Written on a successful promote (the badge otherwise moves silently). */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {optimisticWallets.length === 0 ? (
        <p className="text-sm text-white/60">
          No wallets on your account yet. Connect your first wallet below.
        </p>
      ) : (
        <ul className="space-y-4">
          {optimisticWallets.map((wallet) => (
            <WalletRow
              key={wallet.id}
              wallet={wallet}
              isPending={isPending}
              onExport={setExportingWallet}
              onRemove={setRemovingWallet}
              onSetPrimary={setSettingPrimaryWallet}
            />
          ))}
        </ul>
      )}

      <button
        ref={addButtonRef}
        type="button"
        className={`${AUTH_SECONDARY_BUTTON_CLASS} w-auto`}
        onClick={() => setAddingOpen(true)}
        disabled={isPending}
      >
        Add wallet
      </button>

      {/* Dialogs are siblings of the list (not inside a <li>) so router.refresh() can't replace the
          DOM node out from under an open showModal() dialog and kill its focus trap/backdrop. */}
      {exportingWallet && (
        <WalletExportDialog
          wallet={exportingWallet}
          onClose={handleExportClose}
          onExported={handleExported}
        />
      )}
      {removingWallet && (
        <WalletRemoveDialog
          wallet={removingWallet}
          onResolved={handleRemoved}
          onClose={handleRemoveCancel}
        />
      )}
      {settingPrimaryWallet && (
        <WalletSetPrimaryDialog
          wallet={settingPrimaryWallet}
          currentPrimary={currentPrimary}
          onResolved={handleSetPrimaryResolved}
          onClose={handleSetPrimaryCancel}
        />
      )}
      {addingOpen && <WalletAddDialog onAdded={handleAdded} onClose={handleAddClose} />}
    </div>
  );
}
