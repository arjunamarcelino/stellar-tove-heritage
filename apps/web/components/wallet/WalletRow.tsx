'use client';

import {
  WALLET_DESTRUCTIVE_BUTTON_CLASS,
  WALLET_EXPORTED_BADGE_CLASS,
  WALLET_PRIMARY_BADGE_CLASS,
  WALLET_TRUSTLINE_NEEDED_BADGE_CLASS,
  WALLET_TRUSTLINE_UNAVAILABLE_BADGE_CLASS,
} from '@/components/wallet/constants';
import { AUTH_SECONDARY_BUTTON_CLASS } from '@/components/auth/constants';
import { TRUSTLINE_STATUS_COPY } from '@/lib/wallet/trustlineMessages';
import { truncateAddress } from '@/lib/wallet/format';
import { isRemovable, canSetPrimary } from '@/lib/wallet/eligibility';
import type { TrustlineStatus, WalletSummary } from '@/lib/types/api';

interface Props {
  wallet: WalletSummary;
  isPending: boolean;
  onExport: (wallet: WalletSummary) => void;
  onRemove: (wallet: WalletSummary) => void;
  onSetPrimary: (wallet: WalletSummary) => void;
  // Derived USDC trustline state for a BYOW wallet (TOV-47). Undefined for embedded wallets / while the
  // server derive is streaming. Drives the "USDC trustline needed" badge + CTA.
  trustlineStatus?: TrustlineStatus;
  onAddTrustline?: (wallet: WalletSummary) => void;
}

// Absolute localized date for the "Added …" line; malformed/missing createdAt renders nothing.
function formatAddedDate(createdAt: string | undefined): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function WalletRow({
  wallet,
  isPending,
  onExport,
  onRemove,
  onSetPrimary,
  trustlineStatus,
  onAddTrustline,
}: Props) {
  const isEmbedded = wallet.kind === 'embedded_passkey';
  const addedDate = formatAddedDate(wallet.createdAt);

  // Trustline badge/CTA are BYOW-only (embedded passkey wallets hold USDC without a trustline). 'active'
  // (or an absent status while streaming) shows nothing. missing/unfunded → attention badge + CTA;
  // unavailable/unknown → neutral badge, no CTA (issuer not configured / Horizon read failed).
  const showTrustline =
    !isEmbedded && trustlineStatus !== undefined && trustlineStatus !== 'active';
  const trustlineNeedsAction =
    !isEmbedded && (trustlineStatus === 'missing' || trustlineStatus === 'unfunded');

  function trustlineBadge() {
    if (!showTrustline || !trustlineStatus) return null;
    const { badge } = TRUSTLINE_STATUS_COPY[trustlineStatus];
    const className = trustlineNeedsAction
      ? WALLET_TRUSTLINE_NEEDED_BADGE_CLASS
      : WALLET_TRUSTLINE_UNAVAILABLE_BADGE_CLASS;
    return <span className={className}>{badge}</span>;
  }

  // Trailing action in strict precedence order — each `return` is a rung and the order is load-bearing
  // (exported must win over the action pair; see the `!exported` clause in canSetPrimary). A
  // non-primary, non-exported BYOW is both promotable and removable, so it renders both buttons
  // (set-primary first); an unknown-primary BYOW (isPrimary undefined) renders neither — conservative.
  // The old misleading "Already self-custodied" copy is gone (todo 083).
  function trailingAction() {
    if (wallet.exported) {
      return <span className={WALLET_EXPORTED_BADGE_CLASS}>✓ Wallet exported</span>;
    }
    if (isEmbedded) {
      return (
        <button
          type="button"
          className={`${WALLET_DESTRUCTIVE_BUTTON_CLASS} w-auto`}
          onClick={() => onExport(wallet)}
          disabled={isPending}
        >
          Export to self-custody
        </button>
      );
    }
    if (wallet.isPrimary === true) {
      return <span className="text-xs text-white/40">Primary wallet</span>;
    }
    const promotable = canSetPrimary(wallet);
    const removable = isRemovable(wallet);
    if (!promotable && !removable) return null;
    return (
      <div className="flex items-center gap-2">
        {/* Set-primary is a reversible metadata flip, so it uses the neutral secondary style — NOT the
            sienna WALLET_DESTRUCTIVE_BUTTON_CLASS reserved for irreversible/value-moving actions. */}
        {promotable && (
          <button
            type="button"
            className={`${AUTH_SECONDARY_BUTTON_CLASS} w-auto`}
            onClick={() => onSetPrimary(wallet)}
            disabled={isPending}
            aria-label={`Set wallet ${truncateAddress(wallet.address)} as primary`}
          >
            Set as primary
          </button>
        )}
        {removable && (
          <button
            type="button"
            className={`${WALLET_DESTRUCTIVE_BUTTON_CLASS} w-auto`}
            onClick={() => onRemove(wallet)}
            disabled={isPending}
            aria-label={`Remove wallet ${truncateAddress(wallet.address)}`}
          >
            Remove
          </button>
        )}
      </div>
    );
  }

  return (
    <li className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-charcoal p-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
          {isEmbedded ? 'Embedded wallet' : 'Connected wallet'}
          {wallet.isPrimary && <span className={WALLET_PRIMARY_BADGE_CLASS}>★ Primary</span>}
          {trustlineBadge()}
        </p>
        <p className="truncate font-mono text-xs text-white/50">
          {truncateAddress(wallet.address)}
        </p>
        {addedDate && <p className="text-xs text-white/40">Added {addedDate}</p>}
        {trustlineNeedsAction && onAddTrustline && (
          <button
            type="button"
            className="mt-2 text-xs font-medium text-sienna underline underline-offset-2 hover:text-ochre disabled:opacity-50"
            onClick={() => onAddTrustline(wallet)}
            disabled={isPending}
            aria-label={`Add USDC trustline to wallet ${truncateAddress(wallet.address)}`}
          >
            Add USDC trustline
          </button>
        )}
      </div>

      {trailingAction()}
    </li>
  );
}
