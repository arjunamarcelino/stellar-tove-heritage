'use client';

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import WalletExportDialog from '@/components/wallet/WalletExportDialog';
import WalletRemoveDialog from '@/components/wallet/WalletRemoveDialog';
import WalletAddDialog from '@/components/wallet/WalletAddDialog';
import WalletSetPrimaryDialog from '@/components/wallet/WalletSetPrimaryDialog';
import WalletTrustlineDialog from '@/components/wallet/WalletTrustlineDialog';
import WalletRow from '@/components/wallet/WalletRow';
import Toast from '@/components/ui/Toast';
import { AUTH_SECONDARY_BUTTON_CLASS } from '@/components/auth/constants';
import { revalidateTrustlineStatus } from '@/app/actions/trustline';
import { PLATFORM_USDC } from '@/lib/constants';
import { truncateAddress } from '@/lib/wallet/format';
import type { AddedWallet, StellarAsset, TrustlineStatus, WalletSummary } from '@/lib/types/api';

interface Props {
  wallets: WalletSummary[];
  // Derived USDC trustline status per BYOW wallet, keyed by address (TOV-47). Streams in from the
  // server derive; undefined while pending / for embedded wallets.
  trustlineStatuses?: Record<string, TrustlineStatus>;
  // TOV-48: true when an unfinished wallet rotation exists on the source wallet → show a resume banner.
  rotationActive?: boolean;
  // TOV-48: a one-shot success message to flash as a toast on mount (e.g. after a completed rotation).
  flash?: string;
}

// Single-primary transform for the optimistic promote: flip isPrimary onto the promoted wallet and
// off every other, preserving the exactly-one-primary invariant. Pure (exported for unit tests).
export function promoteInList(wallets: WalletSummary[], promotedId: string): WalletSummary[] {
  return wallets.map((w) => ({ ...w, isPrimary: w.id === promotedId }));
}

export default function WalletSettingsPanel({
  wallets,
  trustlineStatuses = {},
  rotationActive = false,
  flash,
}: Props) {
  const router = useRouter();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const toastSeqRef = useRef(0);
  const flashedRef = useRef(false);
  // Optimistic view of the list so a promote moves the ★ badge immediately; router.refresh() then
  // re-reads authoritative state and useOptimistic reverts to the fresh prop once the transition settles.
  const [optimisticWallets, promoteOptimistic] = useOptimistic(wallets, promoteInList);
  const [exportingWallet, setExportingWallet] = useState<WalletSummary | null>(null);
  const [removingWallet, setRemovingWallet] = useState<WalletSummary | null>(null);
  const [settingPrimaryWallet, setSettingPrimaryWallet] = useState<WalletSummary | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);
  const [trustlineTarget, setTrustlineTarget] = useState<{
    wallet: WalletSummary;
    asset: StellarAsset;
  } | null>(null);
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    tone: 'success' | 'error';
  } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [isPending, startTransition] = useTransition();

  // A monotonic id per toast so an identical repeated message still re-mounts <Toast> and re-arms it.
  function showToast(message: string, tone: 'success' | 'error') {
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, message, tone });
  }

  // One-shot flash (e.g. "Rotation complete") passed from the server after a redirect back to settings.
  // showToast is a stable hoisted declaration and flashedRef/setToast are stable, so [flash] is complete.
  useEffect(() => {
    if (flash && !flashedRef.current) {
      flashedRef.current = true;
      showToast(flash, 'success');
    }
  }, [flash]);

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

  function handleAdded(wallet: AddedWallet) {
    setAddingOpen(false);
    // If the just-bound BYOW wallet lacks the USDC trustline, hand straight off to the trustline dialog
    // (do NOT router.refresh() yet — that would tear down the newly-opened dialog; the refresh happens
    // when the trustline flow resolves/skips). Otherwise refresh normally.
    if (wallet.trustlineRequired && wallet.kind === 'byow') {
      setTrustlineTarget({ wallet, asset: wallet.trustlineRequired.asset });
      return;
    }
    restoreFocus();
    startTransition(() => router.refresh());
  }

  function handleAddClose() {
    setAddingOpen(false);
    restoreFocus();
  }

  // Open the trustline dialog from a settings-row CTA (asset = the env-configured USDC anchor). The CTA
  // only renders when a trustline is needed, which requires a configured issuer — but guard anyway.
  function handleAddTrustline(wallet: WalletSummary) {
    const issuer = PLATFORM_USDC.issuer;
    if (!issuer) return;
    setTrustlineTarget({ wallet, asset: { code: PLATFORM_USDC.code, issuer } });
  }

  async function handleTrustlineDone(added: boolean) {
    const address = trustlineTarget?.wallet.address;
    setTrustlineTarget(null);
    restoreFocus();
    showToast(
      added
        ? 'USDC trustline added — this wallet can now receive USDC.'
        : 'This wallet already has a USDC trustline.',
      'success',
    );
    // Bust the cached badge derive for this address BEFORE refreshing, else router.refresh() re-reads the
    // stale 'missing' value and the "trustline needed" badge lingers for up to the 300s TTL.
    if (address) await revalidateTrustlineStatus(address);
    startTransition(() => router.refresh());
  }

  function handleTrustlineSkip() {
    setTrustlineTarget(null);
    restoreFocus();
    // Refresh so the "USDC trustline needed" badge is re-derived and shown for the skipped wallet.
    startTransition(() => router.refresh());
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

      {rotationActive && (
        <Link
          href="/settings/wallets/rotate"
          className="block rounded-md border border-ochre/40 bg-ochre/10 p-4 text-sm text-ochre hover:bg-ochre/15"
        >
          You have an unfinished wallet move. <span className="underline">Resume →</span>
        </Link>
      )}

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
              trustlineStatus={trustlineStatuses[wallet.address]}
              onAddTrustline={handleAddTrustline}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          ref={addButtonRef}
          type="button"
          className={`${AUTH_SECONDARY_BUTTON_CLASS} w-auto`}
          onClick={() => setAddingOpen(true)}
          disabled={isPending}
        >
          Add wallet
        </button>
        {/* Rotate to a new wallet (TOV-48) — a Link to the dedicated resumable route, not a dialog. */}
        <Link href="/settings/wallets/rotate" className={`${AUTH_SECONDARY_BUTTON_CLASS} w-auto`}>
          Rotate to a new wallet
        </Link>
      </div>

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
      {trustlineTarget && (
        <WalletTrustlineDialog
          wallet={trustlineTarget.wallet}
          asset={trustlineTarget.asset}
          onDone={handleTrustlineDone}
          onSkip={handleTrustlineSkip}
        />
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto max-w-md px-4">
          <Toast
            key={toast.id}
            message={toast.message}
            tone={toast.tone}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </div>
  );
}
