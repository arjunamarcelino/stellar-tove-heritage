'use client';

import { useEffect, useRef, useState } from 'react';
import { useWalletExport } from '@/hooks/useWalletExport';
import {
  truncateAddress,
  explorerAccountUrl,
  explorerTxUrl,
  formatTokenAmount,
} from '@/lib/wallet/format';
import { WALLET_DESTRUCTIVE_BUTTON_CLASS } from '@/components/wallet/constants';
import { AUTH_INPUT_CLASS, AUTH_SECONDARY_BUTTON_CLASS } from '@/components/auth/constants';
import type {
  WalletSummary,
  WalletExportState,
  ExportItem,
  ExportItemStatusDetail,
} from '@/lib/types/api';

interface Props {
  wallet: WalletSummary;
  onClose: () => void;
  onExported: () => void;
}

// States where the flow must not be dismissed (Esc / backdrop / close button) — an in-flight or
// unknown-outcome irreversible action.
// Typed to the state union so a typo or a renamed status fails to compile — this Set gates whether an
// in-flight irreversible transfer can be dismissed (todo 073).
const LOCKED = new Set<WalletExportState['status']>([
  'signing',
  'settling',
  'reconciling',
  'settlementUnknown',
]);

function ItemRow({ item }: { item: ExportItem }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-white/70">{item.displayName}</span>
      <span className="font-mono text-white">
        {formatTokenAmount(item.amountScaled, item.decimals)} {item.assetCode}
      </span>
    </li>
  );
}

// Label + amount for a settlement row, using the display fields enriched from the begin items
// (falling back to the token kind when a correlation wasn't found).
function statusItemLabel(item: ExportItemStatusDetail): string {
  const name = item.displayName ?? (item.tokenKind === 'usdc' ? 'USDC' : 'Fraction');
  if (item.amountScaled !== undefined && item.decimals !== undefined) {
    return `${name} · ${formatTokenAmount(item.amountScaled, item.decimals)} ${item.assetCode ?? ''}`.trim();
  }
  return name;
}

function StatusRow({ item }: { item: ExportItemStatusDetail }) {
  const tone =
    item.status === 'confirmed'
      ? 'text-ochre'
      : item.status === 'failed'
        ? 'text-rose-ash'
        : 'text-white/60';
  return (
    <li className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-white/70">{statusItemLabel(item)}</span>
      <span className="flex items-center gap-3">
        <span className={`font-medium ${tone}`}>{item.status}</span>
        {item.txHash && (
          <a
            href={explorerTxUrl(item.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ochre underline"
          >
            view ↗
          </a>
        )}
      </span>
    </li>
  );
}

export default function WalletExportDialog({ wallet, onClose, onExported }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const {
    state,
    start,
    acknowledgeEducation,
    submitAddress,
    backToAddress,
    confirmAndSign,
    reset,
  } = useWalletExport(wallet.id, wallet.address);

  const [address, setAddress] = useState('');
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState('');

  // Open the modal and kick off the flow once.
  useEffect(() => {
    dialogRef.current?.showModal();
    start();
  }, [start]);

  // Refresh the settings list once the wallet is exported (badge appears, CTA disappears).
  useEffect(() => {
    if (state.status === 'success') onExported();
  }, [state.status, onExported]);

  // Move focus to the step heading on each transition (announce context before controls).
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.status]);

  function handleClose() {
    reset();
    dialogRef.current?.close();
    onClose();
  }

  const locked = LOCKED.has(state.status);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="wallet-export-heading"
      onCancel={(e) => {
        if (locked) e.preventDefault();
        else handleClose();
      }}
      className="m-auto w-full max-w-md rounded-md border border-white/10 bg-charcoal p-6 text-white backdrop:bg-ink/70"
    >
      {/* sr-only live region announcing the current step / outcome */}
      <p className="sr-only" role="status" aria-live="polite">
        {state.status}
      </p>

      {state.status === 'educating' && (
        <div>
          <h2
            id="wallet-export-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            Export to self-custody
          </h2>
          <p className="mt-3 text-sm text-white/70">
            This transfers <strong className="text-white">everything</strong> in this wallet — your
            USDC and every artwork fraction — to a Stellar address you control. Once it settles
            on-chain,
            <strong className="text-white"> Tove cannot reverse or recover it.</strong>
          </p>
          <div className="mt-6 space-y-2">
            <button
              type="button"
              className={WALLET_DESTRUCTIVE_BUTTON_CLASS}
              onClick={acknowledgeEducation}
            >
              I understand, continue
            </button>
            <button type="button" className={AUTH_SECONDARY_BUTTON_CLASS} onClick={handleClose}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(state.status === 'enteringAddress' || state.status === 'checkingAddress') && (
        <div>
          <h2
            id="wallet-export-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            Destination address
          </h2>
          <p className="mt-2 text-sm text-white/60">
            Enter the KYC-approved Stellar address that will receive your assets.
          </p>
          <input
            className={`${AUTH_INPUT_CLASS} mt-4 font-mono`}
            placeholder="G…"
            value={address}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            disabled={state.status === 'checkingAddress'}
            onChange={(e) => setAddress(e.target.value)}
          />
          {state.status === 'enteringAddress' && state.inlineError && (
            <p className="mt-2 text-sm text-rose-ash" role="alert">
              {state.inlineError}
            </p>
          )}
          <div className="mt-6">
            <button
              type="button"
              className={WALLET_DESTRUCTIVE_BUTTON_CLASS}
              disabled={state.status === 'checkingAddress' || address.trim().length === 0}
              onClick={() => submitAddress(address)}
            >
              {state.status === 'checkingAddress' ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      {state.status === 'confirming' &&
        (() => {
          const suffix = state.data.targetAddress.slice(-6);
          // Normalize the typed confirmation so a lowercase/whitespace variant of the (uppercase
          // base32) suffix still matches instead of silently blocking Sign (todo 074).
          const canSign = ack && typed.trim().toUpperCase() === suffix;
          // Zero-amount / dust items are noise on an irreversible confirmation — don't list them.
          const items = state.data.items.filter((item) => !/^0+$/.test(item.amountScaled));
          return (
            <div>
              <h2
                id="wallet-export-heading"
                ref={headingRef}
                tabIndex={-1}
                className="text-lg font-semibold outline-none"
              >
                Confirm export
              </h2>
              <p className="mt-2 text-sm text-white/60">Sending to</p>
              <code className="mt-1 block break-all rounded-sm bg-graphite px-3 py-2 font-mono text-sm text-white">
                {state.data.targetAddress}
              </code>

              <p className="mt-4 text-sm text-white/60">Transferring</p>
              <ul className="mt-1 divide-y divide-white/5 border-y border-white/5">
                {items.map((item) => (
                  <ItemRow key={item.itemId} item={item} />
                ))}
              </ul>

              <label className="mt-4 flex items-start gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-1"
                />
                <span>I understand Tove cannot reverse or recover this transfer.</span>
              </label>

              <label className="mt-3 block text-sm text-white/70">
                Type the last 6 characters of the destination (
                <span className="font-mono">{suffix}</span>) to confirm
                <input
                  className={`${AUTH_INPUT_CLASS} mt-1 font-mono`}
                  value={typed}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                  onChange={(e) => setTyped(e.target.value)}
                />
              </label>

              <div className="mt-6 space-y-2">
                <button
                  type="button"
                  className={WALLET_DESTRUCTIVE_BUTTON_CLASS}
                  disabled={!canSign}
                  aria-describedby="wallet-export-gate"
                  onClick={confirmAndSign}
                >
                  Sign &amp; transfer everything
                </button>
                {!canSign && (
                  <p id="wallet-export-gate" className="text-xs text-white/40">
                    Acknowledge and type the confirmation to continue.
                  </p>
                )}
                <button
                  type="button"
                  className={AUTH_SECONDARY_BUTTON_CLASS}
                  onClick={backToAddress}
                >
                  Change address
                </button>
              </div>
            </div>
          );
        })()}

      {(state.status === 'signing' ||
        state.status === 'settling' ||
        state.status === 'reconciling') && (
        <div className="py-4 text-center" aria-live="polite">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-ochre motion-reduce:animate-none" />
          <h2
            id="wallet-export-heading"
            ref={headingRef}
            tabIndex={-1}
            className="mt-4 text-lg font-semibold outline-none"
          >
            {state.status === 'signing'
              ? 'Confirm each transfer with your passkey'
              : state.status === 'settling'
                ? 'Broadcasting your transfers…'
                : 'Confirming on-chain…'}
          </h2>
          {state.status === 'signing' && (
            <p className="mt-2 text-sm text-white/60">
              Signed {state.signedCount} of {state.data.items.length}. Waiting for Face ID / Touch
              ID…
            </p>
          )}
          {state.status !== 'signing' && (
            <p className="mt-2 text-sm text-white/60">
              This can take a minute or two. Please keep this window open — closing it won’t reverse
              the transfer.
            </p>
          )}
        </div>
      )}

      {state.status === 'settlementUnknown' && (
        <div className="py-2 text-center" role="alert">
          <h2
            id="wallet-export-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold text-ochre outline-none"
          >
            We’re still confirming your transfer
          </h2>
          <p className="mt-2 text-sm text-white/70">
            Don’t retry or close this yet. Check this wallet’s status in your settings in a moment —
            if it shows “exported”, your assets have moved.
          </p>
          <button
            type="button"
            className={`${AUTH_SECONDARY_BUTTON_CLASS} mt-6`}
            onClick={handleClose}
          >
            Back to settings
          </button>
        </div>
      )}

      {state.status === 'success' && (
        <div className="text-center">
          <h2
            id="wallet-export-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            Wallet exported
          </h2>
          <p className="mt-2 text-sm text-white/70">
            Your assets are now in your self-custody wallet.
          </p>
          {state.selfCustodyAddress && (
            <a
              href={explorerAccountUrl(state.selfCustodyAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block font-mono text-sm text-ochre underline"
            >
              {truncateAddress(state.selfCustodyAddress)} ↗
            </a>
          )}

          {/* Settlement proof: link each transfer's on-chain tx so success is auditable (todo 069). */}
          {state.items.some((i) => i.txHash) && (
            <div className="mt-4 text-left">
              <p className="text-xs uppercase tracking-wide text-white/40">Settlement</p>
              <ul className="mt-1 divide-y divide-white/5 border-y border-white/5">
                {state.items.map((item, i) => (
                  <li
                    key={`${item.tokenContract}-${i}`}
                    className="flex items-center justify-between gap-4 py-1.5 text-sm"
                  >
                    <span className="text-white/70">{statusItemLabel(item)}</span>
                    {item.txHash ? (
                      <a
                        href={explorerTxUrl(item.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ochre underline"
                      >
                        view ↗
                      </a>
                    ) : (
                      // On the success screen the export is confirmed; a missing txHash means a
                      // crash-reconciled confirm (status authoritative, txHash best-effort) — it's
                      // settled, just without a provenance link (TOV-40 / todo 069).
                      <span className="text-white/40">settled</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            className={`${WALLET_DESTRUCTIVE_BUTTON_CLASS} mt-6`}
            onClick={handleClose}
          >
            Done
          </button>
        </div>
      )}

      {state.status === 'partial' && (
        <div>
          <h2
            id="wallet-export-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold text-ochre outline-none"
          >
            Partially transferred
          </h2>
          <p className="mt-2 text-sm text-white/70">
            Some transfers completed and some didn’t. Here’s where each one landed:
          </p>
          <ul className="mt-3 divide-y divide-white/5 border-y border-white/5">
            {state.items.map((item, i) => (
              <StatusRow key={`${item.tokenContract}-${i}`} item={item} />
            ))}
          </ul>
          <button
            type="button"
            className={`${AUTH_SECONDARY_BUTTON_CLASS} mt-6`}
            onClick={handleClose}
          >
            Back to settings
          </button>
        </div>
      )}

      {state.status === 'error' && (
        <div className="text-center" role="alert">
          <h2
            id="wallet-export-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            Export couldn’t complete
          </h2>
          <p className="mt-2 text-sm text-white/70">{state.message}</p>
          {/* An `error` state always means nothing moved (moved → partial, unknown → settlementUnknown). */}
          <p className="mt-1 text-sm font-medium text-ochre">
            ✓ Your assets are safe. Nothing was transferred.
          </p>
          <button
            type="button"
            className={`${AUTH_SECONDARY_BUTTON_CLASS} mt-6`}
            onClick={handleClose}
          >
            Back to settings
          </button>
        </div>
      )}
    </dialog>
  );
}
