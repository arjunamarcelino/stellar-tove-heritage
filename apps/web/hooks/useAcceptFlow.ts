'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startPasskeyAssertion, buildAssertionOptions } from '@/lib/webauthn/passkey';
import { mulStroops } from '@/lib/money/format';
import { mintIdempotencyKey } from '@/lib/idempotency';
import { ACCEPT_MESSAGES } from '@/lib/accept/acceptMessages';
import { ACCEPT_ASSERTION_TIMEOUT_MS } from '@/lib/accept/constants';
import { prepareAcceptAction, submitAcceptAction, pollMyTradeAction } from '@/app/actions/accept';
import type {
  AcceptErrorCode,
  AcceptUiCode,
  OpenQuote,
  PrepareAcceptData,
  PrepareAcceptResult,
  SubmitAcceptInput,
  SubmitAcceptResult,
  Trade,
} from '@/lib/types/api';

// The accept ceremony orchestrator (TOV-178 / FR-06.04). Mirrors useBidFlow beat-for-beat (two-gesture model,
// busyRef single-flight, cancelledRef unmount guard, reconcile-once on a lost submit), adapted for the buyer
// accept: the SEC-5 gate compares the CHOSEN quote's gross to the server's prepare quote, and a mismatch means
// the quote drifted server-side → `staleQuote` (re-fetch the list) rather than a silent re-prepare loop.
//
// On a clean 202 the flow lands in `submitted` and HANDS OFF — the parent swaps to the settlement panel, which
// owns useTradePolling; this hook never spawns a poller (it only reconciles ONCE on a lost submit). The dialog
// is remounted by React key per attempt (plan D3), so cancelledRef alone covers cancellation — no epoch guard.
//
// Idempotency (SEC-4): one key minted per acceptQuote and REUSED for that attempt's submit + a
// NETWORK/IN_FLIGHT/ALREADY_IN_FLIGHT reconcile; a fresh key on the next acceptQuote, on a re-prepare after
// error, and on IDEMPOTENCY_KEY_MISMATCH / ACCEPT_CHALLENGE_EXPIRED.

export type AcceptFlowState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'readyToSign'; data: PrepareAcceptData }
  | { status: 'signing' }
  | { status: 'submitting' }
  | { status: 'submitted'; trade: Trade } // HANDOFF — parent owns the settlement poll from here
  | { status: 'reconciling' }
  | { status: 'recheck' } // couldn't confirm a lost submit — manual reconcile
  | { status: 'staleQuote' } // quote no longer acceptable/authorized/RFQ closed — re-fetch the list
  | { status: 'notWhitelisted' } // complete-KYC affordance
  | { status: 'insufficientUsdc'; required?: string; available?: string; message: string }
  | { status: 'sessionExpired' }
  | {
      status: 'error';
      code: AcceptUiCode;
      message: string;
      retry: 'reprepare' | 'resign' | 'none';
    };

export interface UseAcceptFlowReturn {
  state: AcceptFlowState;
  acceptQuote: (rfqId: string, quote: OpenQuote) => Promise<void>;
  sign: () => Promise<void>;
  retry: () => void;
  reconcile: () => Promise<void>;
}

// Build the pending seed Trade handed to the settlement poller from a fresh 202 (which returns only a tradeId).
// The chosen quote supplies count/gross; the rest is null until the poll resolves.
function pendingSeed(tradeId: string, quote: OpenQuote): Trade {
  return {
    tradeId,
    status: 'pending',
    quoteId: quote.quoteId,
    count: quote.fractionCount,
    grossStroops: quote.grossStroops,
    txHash: null,
    settledAt: null,
    failureReason: null,
    registryEventId: null,
    createdAt: new Date().toISOString(),
  };
}

// Retry disposition for a prepare-time backend rejection. Transient transport blips + settlement-unavailable are
// re-preparable; everything else terminal for this hook is routed to a dedicated state (staleQuote/
// notWhitelisted/insufficientUsdc) or → 'none' (the gate/affordance handles it).
function prepareRetry(code: AcceptErrorCode): 'reprepare' | 'none' {
  switch (code) {
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'SERVER_ERROR':
    case 'ACCEPT_SETTLEMENT_UNAVAILABLE':
      return 'reprepare';
    default:
      return 'none';
  }
}

export function useAcceptFlow(): UseAcceptFlowReturn {
  const [state, setStateRaw] = useState<AcceptFlowState>({ status: 'idle' });
  const stateRef = useRef<AcceptFlowState>(state);
  const busyRef = useRef(false); // single-flights the whole prepare→sign→submit sequence
  const cancelledRef = useRef(false);

  const keyRef = useRef<string | null>(null); // current idempotency key (SEC-4)
  const dataRef = useRef<PrepareAcceptData | null>(null); // last prepare envelope (for 'resign')
  const rfqIdRef = useRef<string | null>(null);
  const quoteRef = useRef<OpenQuote | null>(null); // the CHOSEN quote object (frozen at acceptQuote)

  const setState = useCallback((next: AcceptFlowState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Reconcile a possibly-lost submit with exactly ONE getMyTrade read (never a resubmit, never a loop). A trade
  // exists → adopt it and hand off to the poll; SESSION_EXPIRED → re-auth; anything else → recheck.
  const reconcileOnce = useCallback(
    async (rfqId: string) => {
      const res = await pollMyTradeAction(rfqId);
      if (cancelledRef.current) return;
      if (res.status === 'success' && res.trade) {
        setState({ status: 'submitted', trade: res.trade });
        return;
      }
      if (res.status === 'error' && res.code === 'SESSION_EXPIRED') {
        setState({ status: 'sessionExpired' });
        return;
      }
      setState({ status: 'recheck' });
    },
    [setState],
  );

  const handleSubmitResult = useCallback(
    async (res: SubmitAcceptResult, rfqId: string, quote: OpenQuote) => {
      if (res.status === 'success') {
        setState({ status: 'submitted', trade: pendingSeed(res.tradeId, quote) });
        return;
      }
      switch (res.code) {
        case 'NETWORK_ERROR':
        case 'IDEMPOTENCY_KEY_IN_FLIGHT':
        case 'TRADE_ALREADY_IN_FLIGHT':
        case 'SERVER_ERROR':
          // "The trade may exist, outcome unknown" — a drop-after-dispatch, an in-flight key, an already-pending
          // trade, OR a 2xx whose body failed the wire schema (submitAccept maps that to SERVER_ERROR; a 202
          // means the backend ACCEPTED the write, so the trade almost certainly exists — todo 175). Reconcile
          // ONCE, never blind-resubmit, and KEEP the key so any surviving submit stays deduplicated. A genuine
          // 500 with no trade lands in `recheck` (safe: read-only), NOT a fresh-key re-prepare that could double.
          setState({ status: 'reconciling' });
          await reconcileOnce(rfqId);
          return;
        case 'IDEMPOTENCY_KEY_MISMATCH':
        case 'ACCEPT_CHALLENGE_EXPIRED':
          keyRef.current = null; // stale → fresh key + re-prepare
          setState({
            status: 'error',
            code: res.code,
            message: ACCEPT_MESSAGES[res.code],
            retry: 'reprepare',
          });
          return;
        case 'ACCEPT_QUOTE_NOT_ACCEPTABLE':
        case 'ACCEPT_QUOTE_NOT_AUTHORIZED':
        case 'ACCEPT_RFQ_NOT_OPEN':
          setState({ status: 'staleQuote' });
          return;
        case 'ACCEPT_NOT_WHITELISTED':
          setState({ status: 'notWhitelisted' });
          return;
        case 'ACCEPT_INSUFFICIENT_USDC':
          setState({
            status: 'insufficientUsdc',
            message: ACCEPT_MESSAGES.ACCEPT_INSUFFICIENT_USDC,
          });
          return;
        case 'SESSION_EXPIRED':
          setState({ status: 'sessionExpired' });
          return;
        case 'ACCEPT_NOT_RFQ_BUYER':
          setState({
            status: 'error',
            code: res.code,
            message: ACCEPT_MESSAGES[res.code],
            retry: 'none',
          });
          return;
        default:
          setState({
            status: 'error',
            code: res.code,
            message: ACCEPT_MESSAGES[res.code],
            retry: 'reprepare',
          });
      }
    },
    [setState, reconcileOnce],
  );

  const applyPrepareError = useCallback(
    async (res: Extract<PrepareAcceptResult, { status: 'error' }>, rfqId: string) => {
      switch (res.code) {
        case 'ACCEPT_INSUFFICIENT_USDC':
          setState({
            status: 'insufficientUsdc',
            required: res.requiredStroops,
            available: res.availableStroops,
            message: ACCEPT_MESSAGES.ACCEPT_INSUFFICIENT_USDC,
          });
          return;
        case 'ACCEPT_NOT_WHITELISTED':
          setState({ status: 'notWhitelisted' });
          return;
        case 'ACCEPT_QUOTE_NOT_ACCEPTABLE':
        case 'ACCEPT_QUOTE_NOT_AUTHORIZED':
        case 'ACCEPT_RFQ_NOT_OPEN':
          setState({ status: 'staleQuote' });
          return;
        case 'TRADE_ALREADY_IN_FLIGHT':
          // A trade is already pending on this RFQ — adopt it via one reconcile read. AWAITED (todo 185) so
          // busyRef brackets the reconcile, symmetric with the submit path — no early single-flight release.
          setState({ status: 'reconciling' });
          await reconcileOnce(rfqId);
          return;
        case 'SESSION_EXPIRED':
          setState({ status: 'sessionExpired' });
          return;
        default:
          setState({
            status: 'error',
            code: res.code,
            message: ACCEPT_MESSAGES[res.code],
            retry: prepareRetry(res.code),
          });
      }
    },
    [setState, reconcileOnce],
  );

  const acceptQuote = useCallback(
    async (rfqId: string, quote: OpenQuote) => {
      if (busyRef.current) return; // single-flight: a double-click fires exactly one prepare
      busyRef.current = true;
      rfqIdRef.current = rfqId;
      quoteRef.current = quote; // freeze the chosen quote object (never a live list index)
      const key = mintIdempotencyKey();
      keyRef.current = key;
      setState({ status: 'preparing' });
      try {
        const res = await prepareAcceptAction(rfqId, { quoteId: quote.quoteId }, key);
        if (cancelledRef.current) return;

        if (res.status === 'error') {
          await applyPrepareError(res, rfqId);
          return;
        }

        // SEC-5 endpoint-drift gate: the chosen quote's gross MUST equal the server's prepare quote, else the
        // quote changed server-side → staleQuote (re-fetch the list), never sign an unseen amount. Both sides
        // normalized through BigInt→string. mulStroops multiplies two i128 STRINGS (fractionCount is not a
        // JS number).
        const clientGross = mulStroops(quote.pricePerFractionStroops, quote.fractionCount);
        if (clientGross !== BigInt(res.data.trade.grossStroops).toString()) {
          keyRef.current = null;
          setState({ status: 'staleQuote' });
          return;
        }

        dataRef.current = res.data;
        setState({ status: 'readyToSign', data: res.data });
      } finally {
        busyRef.current = false;
      }
    },
    [setState, applyPrepareError],
  );

  const sign = useCallback(async () => {
    if (busyRef.current) return;
    const current = stateRef.current;
    if (current.status !== 'readyToSign') return; // passkey only fires from a fresh, ready gesture

    busyRef.current = true;
    const { data } = current;
    const rfqId = rfqIdRef.current;
    const quote = quoteRef.current;
    const key = keyRef.current;
    try {
      if (!rfqId || !quote || !key) {
        setState({
          status: 'error',
          code: 'SERVER_ERROR',
          message: ACCEPT_MESSAGES.SERVER_ERROR,
          retry: 'reprepare',
        });
        return;
      }

      setState({ status: 'signing' });
      const assertion = await startPasskeyAssertion(
        buildAssertionOptions({
          challenge: data.challenge,
          credentialId: data.credentialId,
          rpId: data.rpId,
          transports: data.transports,
          timeoutMs: ACCEPT_ASSERTION_TIMEOUT_MS,
        }),
      );
      if (cancelledRef.current) return;

      if (assertion.status === 'cancelled') {
        setState({ status: 'readyToSign', data }); // recoverable, no auto-retry
        return;
      }
      if (assertion.status === 'error') {
        setState({
          status: 'error',
          code: 'PASSKEY_FAILED',
          message: ACCEPT_MESSAGES.PASSKEY_FAILED,
          retry: 'resign',
        });
        return;
      }

      // Extract the base64url assertion fields verbatim (SEC-6) and echo the buyer auth entry exactly. The
      // shipped AcceptDto takes exactly these five fields — no credentialId (PR #49).
      const submitInput: SubmitAcceptInput = {
        quoteId: quote.quoteId,
        buyerAuthEntryXdr: data.buyerAuthEntryXdr,
        authenticatorData: assertion.response.response.authenticatorData,
        clientDataJSON: assertion.response.response.clientDataJSON,
        signature: assertion.response.response.signature,
      };

      setState({ status: 'submitting' });
      const res = await submitAcceptAction(rfqId, submitInput, key);
      if (cancelledRef.current) return;
      await handleSubmitResult(res, rfqId, quote);
    } finally {
      busyRef.current = false;
    }
  }, [setState, handleSubmitResult]);

  // Manual reconcile from `recheck` — one more getMyTrade read, key kept.
  const reconcile = useCallback(async () => {
    if (busyRef.current) return;
    if (stateRef.current.status !== 'recheck') return;
    const rfqId = rfqIdRef.current;
    if (!rfqId) return;
    busyRef.current = true;
    try {
      setState({ status: 'reconciling' });
      await reconcileOnce(rfqId);
    } finally {
      busyRef.current = false;
    }
  }, [setState, reconcileOnce]);

  // Recover from a non-terminal failure surface. 'reprepare' drops the key + returns to idle (a fresh key is
  // minted on the next acceptQuote); 'resign' returns to readyToSign if the prepare envelope is still in hand.
  const retry = useCallback(() => {
    const current = stateRef.current;
    if (current.status === 'error') {
      if (current.retry === 'reprepare') {
        keyRef.current = null;
        setState({ status: 'idle' });
      } else if (current.retry === 'resign') {
        const data = dataRef.current;
        setState(data ? { status: 'readyToSign', data } : { status: 'idle' });
      }
      return; // retry 'none' → no-op (the caller shows a different affordance)
    }
    if (current.status === 'insufficientUsdc') {
      keyRef.current = null;
      setState({ status: 'idle' });
    }
  }, [setState]);

  return { state, acceptQuote, sign, retry, reconcile };
}
