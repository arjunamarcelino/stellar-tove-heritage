'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useWalletRotation } from '@/hooks/useWalletRotation';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';
import {
  ERROR_CLASS,
  MUTED_LINK,
  TONE_CARD_BASE,
  TONE_ACCENT,
  TONE_WARNING,
  TONE_NEUTRAL,
} from '@/components/ui/surfaces';
import { formatTokenAmount, truncateAddress, explorerTxUrl } from '@/lib/wallet/format';
import { lockupBlockedMessage, classifyTransferItemCode } from '@/lib/wallet/rotationMessages';
import { SITE_CONFIG } from '@/lib/constants';
import type { RotationStatusData, WalletRotationState, WalletSummary } from '@/lib/types/api';

const STEPS = [
  { key: 'destination', label: 'Destination' },
  { key: 'review', label: 'Review' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'done', label: 'Done' },
] as const;

function activeIndex(state: WalletRotationState): number {
  switch (state.status) {
    case 'loading':
    case 'selectingDestination':
      return 0;
    case 'reviewing':
      return 1;
    case 'transferring':
    case 'paused':
    case 'settlementUnknown':
      return 2;
    case 'partial':
    case 'complete':
      return 3;
    case 'error':
      return -1;
    default: {
      // Exhaustiveness guard — a new WalletRotationState member must be handled here (compile error).
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function headingFor(state: WalletRotationState): string {
  switch (state.status) {
    case 'loading':
      return 'Preparing…';
    case 'selectingDestination':
      return 'Choose your new wallet';
    case 'reviewing':
      return 'Review the move';
    case 'transferring':
      return 'Moving your fractions';
    case 'paused':
      return 'Paused — resume to finish';
    case 'partial':
      return 'Partly moved';
    case 'settlementUnknown':
      return 'Still working…';
    case 'complete':
      return 'Rotation complete';
    case 'error':
      return 'Something went wrong';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function announce(state: WalletRotationState): string {
  switch (state.status) {
    case 'loading':
      return 'Preparing your wallet move.';
    case 'selectingDestination':
      return 'Step 1: choose the wallet to move your fractions to.';
    case 'reviewing':
      return 'Step 2: review the fractions that will move, then confirm.';
    case 'transferring':
      return `Transferring: ${state.confirmedCount} of ${state.total} moved.`;
    case 'paused':
      return `Paused: ${state.confirmedCount} of ${state.total} moved. Resume to finish.`;
    case 'partial':
      return `${state.confirmedCount} of ${state.total} fractions moved. Some could not be moved.`;
    case 'settlementUnknown':
      return `Taking longer than usual. ${state.confirmedCount} of ${state.total} moved so far. It’s safe to leave and come back.`;
    case 'complete':
      return `Complete: ${state.movedCount} fractions moved to your new wallet.`;
    case 'error':
      return state.message;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

interface Props {
  sourceWalletId: string;
  wallets: WalletSummary[];
  initialStatus: RotationStatusData | null;
}

// Client orchestrator for the wallet-rotation wizard (TOV-48 / FR-01.12). Owns the single focused step
// heading (moved on each transition for SR users), the polite live region (throttled to milestones), the
// numbered stepper, and the per-state screens. A dedicated, reload-safe route — an in-flight rotation
// rehydrates from the SSR `initialStatus` via the hook's resume().
export default function WalletRotationWizard({ sourceWalletId, wallets, initialStatus }: Props) {
  const rotation = useWalletRotation(sourceWalletId, wallets, initialStatus);
  const { state } = rotation;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resumedRef = useRef(false);

  // Local pre-transfer selection state (the hook's set-primary + initiate fire on chooseDestination).
  const [picked, setPicked] = useState<WalletSummary | null>(null);

  // Focus the heading only on genuine STEP changes (not on every progress re-render).
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.status]);

  // Rehydrate an in-flight rotation once on mount (busyRef makes a double-call safe under StrictMode).
  useEffect(() => {
    if (!resumedRef.current && initialStatus && initialStatus.state !== 'none') {
      resumedRef.current = true;
      void rotation.resume();
    }
  }, [initialStatus, rotation]);

  const eligible = wallets.filter(
    (w) => w.kind === 'byow' && !w.exported && w.id !== sourceWalletId,
  );
  const idx = activeIndex(state);

  return (
    <div className="space-y-8">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce(state)}
      </p>

      {idx >= 0 && (
        <ol className="flex items-center gap-2 text-xs" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              aria-current={i === idx ? 'step' : undefined}
              className={`flex items-center gap-2 ${i === idx ? 'font-semibold text-charcoal' : 'text-charcoal/50'}`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                  i <= idx ? 'border-charcoal bg-charcoal text-bone' : 'border-charcoal/30'
                }`}
              >
                {i + 1}
              </span>
              <span>{s.label}</span>
              {i < STEPS.length - 1 && (
                <span aria-hidden="true" className="text-charcoal/30">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl text-charcoal outline-none"
      >
        {headingFor(state)}
      </h2>

      {state.status === 'loading' && <p className="text-sm text-charcoal/60">Setting things up…</p>}

      {state.status === 'selectingDestination' &&
        (picked ? (
          <div className="space-y-6">
            <p className="text-sm text-charcoal/70">
              We’ll make <span className="font-mono">{truncateAddress(picked.address)}</span> your
              primary settlement wallet
              {picked.isPrimary ? ' (it already is)' : ''}, then move your fractions to it. Your old
              wallet stays until you’re done.
            </p>
            <div className="flex items-center gap-3">
              <button type="button" className={SECONDARY_BUTTON} onClick={() => setPicked(null)}>
                Back
              </button>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                onClick={() =>
                  rotation.chooseDestination({ id: picked.id, address: picked.address })
                }
              >
                Make primary &amp; continue
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {eligible.length === 0 ? (
              <p className="text-sm text-charcoal/70">
                You don’t have another connected wallet yet. Connect one from{' '}
                <Link href="/settings" className={MUTED_LINK}>
                  wallet settings
                </Link>{' '}
                first, then come back to rotate.
              </p>
            ) : (
              <ul className="space-y-3">
                {eligible.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(w)}
                      className="flex w-full items-center justify-between rounded-md border border-charcoal/15 bg-charcoal/5 p-4 text-left text-sm hover:bg-charcoal/10"
                    >
                      <span className="font-mono text-charcoal">{truncateAddress(w.address)}</span>
                      <span className="text-charcoal/50">Connected wallet</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

      {state.status === 'reviewing' && state.blocked && (
        <div className="space-y-6">
          <div className={`${TONE_CARD_BASE} ${TONE_WARNING}`} role="status">
            <p>
              {state.blocked.code === 'ROTATION_BLOCKED_BY_LOCKUP'
                ? lockupBlockedMessage(state.blocked.lockupExpiresAt)
                : state.blocked.message}
            </p>
          </div>
          <p id="rotate-blocked-reason" className="text-sm text-charcoal/60">
            {state.blocked.code === 'ROTATION_BLOCKED_BY_LOCKUP'
              ? 'Rotation will be available once every locked position unlocks.'
              : 'Your new wallet must complete verification before it can receive fractions.'}
          </p>
          {/* Disclose the set-primary side effect: it already committed before this block was reached. */}
          <p className="text-sm text-charcoal/60">
            Note: {truncateAddress(state.destination.address)} is now your primary settlement
            wallet. Your fractions stay on your old wallet; choosing a different wallet won’t change
            that back automatically.
          </p>
          <div className="flex items-center gap-3">
            {/* Back clears the pending server-side rotation (initiate already created it) so the user can retarget. */}
            <button type="button" className={SECONDARY_BUTTON} onClick={rotation.cancel}>
              Choose a different wallet
            </button>
            {/* aria-disabled (not native disabled) keeps the control focusable + explains why (WCAG 4.1.3). */}
            <button
              type="button"
              className={PRIMARY_BUTTON}
              aria-disabled="true"
              aria-describedby="rotate-blocked-reason"
              onClick={(e) => e.preventDefault()}
            >
              Confirm &amp; move
            </button>
          </div>
        </div>
      )}

      {state.status === 'reviewing' && !state.blocked && (
        <div className="space-y-6">
          <ul className="divide-y divide-charcoal/10 rounded-md border border-charcoal/15">
            {state.items.map((item) => (
              <li key={item.itemId} className="flex items-center justify-between p-4 text-sm">
                <span className="text-charcoal">{item.displayName ?? 'Fraction'}</span>
                <span className="font-mono text-charcoal">
                  ×{formatTokenAmount(item.amountScaled, item.decimals ?? 0)}
                </span>
              </li>
            ))}
          </ul>
          <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL}`} role="note">
            <p>
              USDC stays on your current wallet — it isn’t moved here. You can export it separately
              afterwards.
            </p>
          </div>
          <p className="text-sm text-charcoal/70">
            <span className="font-medium text-charcoal">No network fee</span> — Tove covers the
            Stellar costs. You’ll approve <span className="font-medium">{state.items.length}</span>{' '}
            {state.items.length === 1 ? 'signature' : 'signatures'} with your passkey, one per
            fraction.
          </p>
          {/* Disclose the set-primary side effect (committed at chooseDestination, before this screen). */}
          <p className="text-sm text-charcoal/60">
            <span className="font-medium text-charcoal">
              {truncateAddress(state.destination.address)} is now your primary settlement wallet.
            </span>{' '}
            Your fractions stay on your old wallet until this move completes; cancelling leaves the
            new wallet as your primary.
          </p>
          <div className="flex items-center gap-3">
            {/* Back cancels the pending rotation server-side (initiate already created it). */}
            <button type="button" className={SECONDARY_BUTTON} onClick={rotation.cancel}>
              Cancel
            </button>
            <button type="button" className={PRIMARY_BUTTON} onClick={rotation.confirmAndTransfer}>
              Confirm &amp; move
            </button>
          </div>
        </div>
      )}

      {state.status === 'transferring' && (
        <div className="space-y-4">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={state.total}
            aria-valuenow={state.confirmedCount}
            aria-valuetext={`${state.confirmedCount} of ${state.total} transferred`}
            className="h-2 w-full overflow-hidden rounded-full bg-charcoal/10"
          >
            <div
              className="h-full bg-charcoal transition-all"
              style={{ width: `${state.total ? (state.confirmedCount / state.total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-sm text-charcoal">
            Transferred {state.confirmedCount} of {state.total}
          </p>
          <p className="text-sm text-charcoal/60">
            {state.phase === 'signing'
              ? 'Approve each transfer on your device — one tap per fraction.'
              : 'This can take a few minutes. It’s safe to leave this page and come back — your progress is saved.'}
          </p>
        </div>
      )}

      {state.status === 'paused' && (
        <div className="space-y-6">
          <p className="text-sm text-charcoal/70">
            {state.confirmedCount} of {state.total} fractions have moved. Resume to finish the rest
            — you’ll approve the remaining signatures.
          </p>
          <button type="button" className={PRIMARY_BUTTON} onClick={rotation.resume}>
            Resume
          </button>
        </div>
      )}

      {state.status === 'settlementUnknown' && (
        <div className="space-y-6">
          <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL}`} role="status">
            <p>
              This is taking longer than usual — {state.confirmedCount} of {state.total} moved so
              far. It’s safe to leave and come back; nothing is lost.
            </p>
          </div>
          <button type="button" className={PRIMARY_BUTTON} onClick={rotation.resume}>
            Check status
          </button>
        </div>
      )}

      {state.status === 'partial' && (
        <div className="space-y-6">
          <div className={`${TONE_CARD_BASE} ${TONE_WARNING}`} role="status">
            <p>
              {state.confirmedCount} of {state.total} fractions moved to your new wallet. The rest
              couldn’t be moved. Your new wallet is now your primary — your remaining fractions are
              still on the old one.
            </p>
          </div>
          <ul className="divide-y divide-charcoal/10 rounded-md border border-charcoal/15">
            {state.items.map((item) => (
              <li key={item.itemId} className="flex items-center justify-between p-4 text-sm">
                <span className="text-charcoal">{item.displayName ?? 'Fraction'}</span>
                {item.status === 'confirmed' ? (
                  item.txHash ? (
                    <a
                      href={explorerTxUrl(item.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className={MUTED_LINK}
                    >
                      Moved ↗
                    </a>
                  ) : (
                    <span className="text-charcoal/60">Moved</span>
                  )
                ) : (
                  <span className="text-umber">
                    {classifyTransferItemCode(item.errorCode).message}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className={PRIMARY_BUTTON} onClick={rotation.resume}>
            Retry the rest
          </button>
        </div>
      )}

      {state.status === 'complete' && (
        <div className="space-y-6">
          <div className={`${TONE_CARD_BASE} ${TONE_ACCENT}`} role="status">
            <p>
              ✓ {state.movedCount} {state.movedCount === 1 ? 'fraction' : 'fractions'} moved to{' '}
              <span className="font-mono">{truncateAddress(state.destination.address)}</span>, now
              your primary wallet.
            </p>
          </div>
          <p className="text-sm text-charcoal/60">
            Your old wallet may still hold USDC. You can export that separately from wallet
            settings.
          </p>
          <Link href="/settings?rotated=1" className={PRIMARY_BUTTON}>
            Done — back to settings
          </Link>
        </div>
      )}

      {state.status === 'error' && (
        <div className="space-y-6">
          <p role="alert" className={ERROR_CLASS}>
            {state.message}
          </p>
          <div className="flex items-center gap-3">
            <Link href="/settings" className={SECONDARY_BUTTON}>
              Back to settings
            </Link>
            {state.code === 'SESSION_EXPIRED' ? (
              <Link href="/login" className={PRIMARY_BUTTON}>
                Sign in
              </Link>
            ) : (
              <button type="button" className={PRIMARY_BUTTON} onClick={rotation.reset}>
                Start over
              </button>
            )}
          </div>
        </div>
      )}

      <p className="pt-4 text-xs text-charcoal/40">
        Need help? Contact {SITE_CONFIG.supportEmail}.
      </p>
    </div>
  );
}
