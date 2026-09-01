'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useBidFlow } from '@/hooks/useBidFlow';
import { detectPasskeySupport } from '@/lib/webauthn/passkey';
import {
  usdcToStroops,
  stroopsToUsdc,
  clampToBand,
  isWithinBand,
  escrowAmount,
  formatUsdc,
} from '@/lib/offerings/format';
import { SLIDER_STEP_STROOPS } from '@/lib/offerings/constants';
import { OFFERING_PRIMARY_BUTTON, OFFERING_ERROR_CLASS, MONEY_FIGURE } from './constants';
import BidGateCta from './BidGateCta';
import type { Bid, Offering } from '@/lib/types/api';

// The bid form (TOV-157 / FR-05.03, WS-F). Drives the whole prepare → sign → submit ceremony via useBidFlow
// and switches over its state union (closed with a `never` guard so a new phase can't render silently).
//
// Price authority (AC-22): the USDC numeric input is authoritative — users type "0.5", validated via
// usdcToStroops (reject only >7 decimals + out-of-band, NEVER sub-USDC). The stroops read-out and the coarse
// `aria-hidden`/`tabIndex=-1` slider are mirrors, not sources. Clamp-to-band happens on BLUR, not per keystroke
// (a keystroke clamp fights the typist). `low === high` collapses to a fixed read-only price (no input/slider).
//
// Two-gesture model: the passkey MUST fire from the "Sign with passkey" click (a fresh user gesture), not from
// prepare — so readyToSign renders a distinct sign step. Single-flight lives in the hook; the submit is
// disabled with aria-busy while any async phase is in flight.

// Trim the canonical 7-dp form ("5.0000000" → "5", "0.5000000" → "0.5") for a clean input value.
function trimUsdc(usdc: string): string {
  return usdc.replace(/\.?0+$/, '') || '0';
}

function defaultUsdc(lowStroops: string): string {
  return trimUsdc(stroopsToUsdc(lowStroops));
}

export default function BidPanel({
  offering,
  onSubmitted,
}: {
  offering: Offering;
  onSubmitted: (bid: Bid) => void;
}) {
  const { state, placeBid, sign, retry, reconcile } = useBidFlow();

  // Feature-detect a passkey-capable device once on mount (G8). `null` = still detecting.
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void detectPasskeySupport().then((r) => {
      if (alive) setSupported(r.supported);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Hand a placed bid UP to the parent (todo 146): the parent renders ActiveBidCard as a SIBLING of the gate,
  // so a window-close tick (which swaps this biddable-branch body for the "closed" message) can never unmount
  // the live escrow poll of a bid the collector just successfully placed.
  useEffect(() => {
    if (state.status === 'submitted') onSubmitted(state.bid);
  }, [state, onSubmitted]);

  const { lowPriceStroops: low, highPriceStroops: high, publicFloat } = offering;
  const fixedPrice = low === high;

  const [priceUsdc, setPriceUsdc] = useState(() => defaultUsdc(low));
  const [count, setCount] = useState('1');

  // Derive stroops + validity from the current inputs (pure, recomputed each render — cheap BigInt compares).
  const parsed = usdcToStroops(priceUsdc);
  const priceStroops = fixedPrice ? low : parsed.ok ? parsed.stroops : null;
  const withinBand = priceStroops !== null && isWithinBand(priceStroops, low, high);

  const countValid =
    /^\d+$/.test(count) && Number(count) >= 1 && BigInt(count) <= BigInt(publicFloat);
  // `count` rides as a JS number end-to-end (BidInput.count). Safe because it's bounded by `publicFloat`
  // (a fraction count — realistically thousands, always ≪ 2^53); the bound above is checked exactly via
  // BigInt, so a >2^53 count would fail validation before Number() could round it (todo 153).
  const countNum = countValid ? Number(count) : 0;

  const canSubmit = priceStroops !== null && withinBand && countValid;
  // Pre-prepare: the live client preview from the typed inputs. At `readyToSign` — the moment the user
  // authorizes the amount before clicking Sign — the headline is the SERVER-authoritative
  // escrowAmountStroops encoded in the txXdr being signed (todo 148), a pure derivation (no cascading
  // setState). Post-sign the inputs are locked and SEC-5-gated, so the client value still equals it.
  const clientEscrow =
    priceStroops !== null && countValid ? escrowAmount(priceStroops, countNum) : null;
  const youPayStroops =
    state.status === 'readyToSign' ? state.data.escrowAmountStroops : clientEscrow;
  const youPay = youPayStroops !== null ? formatUsdc(youPayStroops) : null;

  // Inline input errors (only meaningful while the user can act — the idle form).
  let inputError: string | null = null;
  if (!fixedPrice && !parsed.ok) {
    inputError =
      parsed.reason === 'too-precise'
        ? 'Use up to 7 decimal places.'
        : 'Enter a valid USDC amount.';
  } else if (!fixedPrice && !withinBand) {
    inputError = `Enter a price between ${formatUsdc(low)} and ${formatUsdc(high)} USDC.`;
  } else if (!countValid) {
    inputError = `Enter between 1 and ${publicFloat} fractions.`;
  }

  function onPlace() {
    if (!canSubmit || priceStroops === null) return;
    void placeBid(offering.id, { price: priceStroops, count: countNum });
  }

  function onPriceBlur() {
    // Clamp into the band on blur (not per keystroke) so a typed out-of-band price snaps back once committed.
    if (fixedPrice || !parsed.ok) return;
    const clamped = clampToBand(parsed.stroops, low, high);
    if (clamped !== parsed.stroops) setPriceUsdc(defaultUsdc(clamped));
  }

  // ── Terminal branches that replace the form entirely ──
  if (supported === null) {
    return (
      <div aria-busy="true" className="space-y-3">
        <div className="h-10 rounded bg-charcoal/10 motion-safe:animate-pulse" />
        <div className="h-14 rounded bg-charcoal/10 motion-safe:animate-pulse" />
      </div>
    );
  }
  if (!supported) return <BidGateCta reason="unsupported" />;
  if (state.status === 'submitted') {
    // Handed off to the parent (see the onSubmitted effect); render nothing for the frame before it swaps in
    // ActiveBidCard, so the poll isn't briefly double-mounted here and in the parent.
    return null;
  }
  // A whitelisted collector without an embedded wallet surfaces WALLET_NOT_FOUND (404, branched on errorCode)
  // → the enrol gate, not a generic error (G8).
  if (state.status === 'error' && state.code === 'WALLET_NOT_FOUND') {
    return <BidGateCta reason="no-passkey" />;
  }
  if (state.status === 'sessionExpired') {
    // Inline re-auth via the shared gate card (todo 151). BidPanel stays mounted behind it, so the entered
    // price/count survive re-auth (G9).
    return <BidGateCta reason="session-expired" />;
  }

  // ── The form (idle / preparing / readyToSign / signing / submitting / reconciling / recheck /
  //    insufficientBalance / error) ──
  const busy =
    state.status === 'preparing' ||
    state.status === 'signing' ||
    state.status === 'submitting' ||
    state.status === 'reconciling';
  const locked = busy || state.status === 'readyToSign';

  // The error/insufficient-balance copy shown ABOVE the submit, in ERROR_CLASS.
  let errorText: string | null = null;
  if (state.status === 'insufficientBalance') {
    errorText =
      state.required && state.available
        ? `Need ${formatUsdc(state.required)} USDC, you have ${formatUsdc(state.available)} USDC.`
        : state.message;
  } else if (state.status === 'error') {
    errorText = state.message;
  } else if (state.status === 'idle') {
    errorText = inputError;
  }

  // The action affordance below the ledger, per phase.
  let action: ReactNode;
  switch (state.status) {
    case 'idle':
      action = (
        <button
          type="button"
          onClick={onPlace}
          aria-disabled={!canSubmit}
          className={OFFERING_PRIMARY_BUTTON}
        >
          Place bid{canSubmit && youPay ? ` · ${youPay} USDC` : ''}
        </button>
      );
      break;
    case 'preparing':
      action = (
        <button type="button" aria-disabled aria-busy className={OFFERING_PRIMARY_BUTTON}>
          Preparing…
        </button>
      );
      break;
    case 'readyToSign':
      action = (
        <button type="button" onClick={() => void sign()} className={OFFERING_PRIMARY_BUTTON}>
          Sign with passkey
        </button>
      );
      break;
    case 'signing':
      action = (
        <button type="button" aria-disabled aria-busy className={OFFERING_PRIMARY_BUTTON}>
          Waiting for passkey…
        </button>
      );
      break;
    case 'submitting':
      action = (
        <button type="button" aria-disabled aria-busy className={OFFERING_PRIMARY_BUTTON}>
          Placing bid…
        </button>
      );
      break;
    case 'reconciling':
      action = (
        <button type="button" aria-disabled aria-busy className={OFFERING_PRIMARY_BUTTON}>
          Confirming…
        </button>
      );
      break;
    case 'recheck':
      action = (
        <div className="space-y-2">
          <p className="text-sm text-charcoal/70">We couldn’t confirm your bid landed.</p>
          <button
            type="button"
            onClick={() => void reconcile()}
            className={OFFERING_PRIMARY_BUTTON}
          >
            Re-check
          </button>
        </div>
      );
      break;
    case 'insufficientBalance':
      action = (
        <button type="button" onClick={retry} className={OFFERING_PRIMARY_BUTTON}>
          Adjust bid
        </button>
      );
      break;
    case 'error':
      // Retry disposition comes from the hook: 'reprepare' resets to idle, 'resign' returns to the sign step,
      // 'none' offers no retry (the copy above carries the outcome).
      action =
        state.retry === 'none' ? null : (
          <button type="button" onClick={retry} className={OFFERING_PRIMARY_BUTTON}>
            {state.retry === 'resign' ? 'Sign again' : 'Try again'}
          </button>
        );
      break;
    default: {
      const _exhaustive: never = state;
      throw new Error(`unreachable bid flow state: ${String(_exhaustive)}`);
    }
  }

  return (
    <section aria-label="Place a bid" aria-busy={busy} className="space-y-4">
      <p className="sr-only" role="status" aria-live="polite">
        {busy ? 'Placing your bid…' : ''}
      </p>

      {/* Price control */}
      <div>
        <label htmlFor="bid-price" className="text-xs uppercase tracking-wide text-charcoal/50">
          Price per fraction (USDC)
        </label>
        {fixedPrice ? (
          <p id="bid-price" className={`mt-1 text-lg ${MONEY_FIGURE}`}>
            {formatUsdc(low)} USDC <span className="text-xs text-charcoal/50">(fixed)</span>
          </p>
        ) : (
          <>
            <input
              id="bid-price"
              type="text"
              inputMode="decimal"
              value={priceUsdc}
              disabled={locked}
              onChange={(e) => setPriceUsdc(e.target.value)}
              onBlur={onPriceBlur}
              className="mt-1 w-full rounded-sm border border-charcoal/20 px-3 py-2 font-heading tabular-nums text-umber disabled:opacity-50"
            />
            <p className="mt-1 tabular-nums text-xs text-charcoal/50">
              = {priceStroops ?? '—'} stroops
            </p>
            {/* Coarse mirror only — the numeric input is authoritative, so this is hidden from AT/tab order. */}
            <input
              type="range"
              aria-hidden="true"
              tabIndex={-1}
              min={low}
              max={high}
              step={SLIDER_STEP_STROOPS}
              value={withinBand && priceStroops !== null ? priceStroops : low}
              disabled={locked}
              onChange={(e) => setPriceUsdc(defaultUsdc(e.target.value))}
              className="mt-2 w-full accent-ochre"
            />
          </>
        )}
      </div>

      {/* Count */}
      <div>
        <label htmlFor="bid-count" className="text-xs uppercase tracking-wide text-charcoal/50">
          Fractions
        </label>
        <input
          id="bid-count"
          type="number"
          min={1}
          max={publicFloat}
          value={count}
          disabled={locked}
          onChange={(e) => setCount(e.target.value)}
          className="mt-1 w-32 rounded-sm border border-charcoal/20 px-3 py-2 font-heading tabular-nums text-umber disabled:opacity-50"
        />
      </div>

      {/* "You pay" — the ledger's culminating figure */}
      <div className="border-t border-charcoal/10 pt-3">
        <p className="text-xs uppercase tracking-wide text-charcoal/50">You pay</p>
        <p className={`text-3xl ${MONEY_FIGURE}`}>
          {youPay ?? '—'} <span className="text-base">USDC</span>
        </p>
        {youPay && priceStroops !== null ? (
          <p className="mt-1 text-sm text-charcoal/60">
            {formatUsdc(priceStroops)} USDC × {countNum} fractions, held in escrow.
          </p>
        ) : null}
      </div>

      {errorText ? <p className={OFFERING_ERROR_CLASS}>{errorText}</p> : null}

      {action}
    </section>
  );
}
