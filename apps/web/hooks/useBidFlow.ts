'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startPasskeyAssertion, buildAssertionOptions } from '@/lib/webauthn/passkey';
import { escrowAmount } from '@/lib/offerings/format';
import { mintIdempotencyKey } from '@/lib/idempotency';
import { OFFERINGS_MESSAGES } from '@/lib/offerings/offeringsMessages';
import { prepareBidAction, submitBidAction, refreshMyBidAction } from '@/app/actions/offerings';
import type {
  Bid,
  BidErrorCode,
  BidInput,
  OfferingUiCode,
  PrepareBidData,
  PrepareBidResult,
  SubmitBidInput,
  SubmitBidResult,
} from '@/lib/types/api';

const BID_ASSERTION_TIMEOUT_MS = 120_000; // generous — cross-device (QR/hybrid) signing is slow

// The bid ceremony orchestrator (TOV-157 / FR-05.03, WS-E). Folds the idempotency key + WebAuthn assertion
// extraction inline (no useBidIdempotency / bidCeremony files — mirrors the useWalletExport precedent).
//
// Two-gesture model: `prepare` (a quote — no reservation) and `sign` are SEPARATE user actions so the
// passkey fires from a fresh user gesture. The whole prepare→sign→submit sequence is single-flight (busyRef,
// AC-14). On a clean 201 the flow lands in `submitted` and HANDS OFF — the parent switches to ActiveBidCard,
// which owns the poll; this hook never spawns a second poller (it only reconciles ONCE on a lost submit).
//
// Idempotency (SEC-4): one key minted per placeBid and REUSED for that placeBid's submit. A fresh key is
// minted on the next placeBid, on a re-prepare after error, and on IDEMPOTENCY_KEY_MISMATCH. mintIdempotencyKey
// (shared, lib/idempotency.ts) wraps crypto.randomUUID in a fallback because it throws in a non-secure context.

export type BidFlowState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'readyToSign'; data: PrepareBidData }
  | { status: 'signing' }
  | { status: 'submitting' }
  | { status: 'submitted'; bid: Bid } // HANDOFF — parent owns the poll from here
  | { status: 'reconciling' }
  | { status: 'recheck' } // couldn't confirm a lost submit — manual reconcile
  | { status: 'insufficientBalance'; required?: string; available?: string; message: string }
  | { status: 'sessionExpired' }
  | {
      status: 'error';
      code: OfferingUiCode;
      message: string;
      retry: 'reprepare' | 'resign' | 'none';
    };

export interface UseBidFlowReturn {
  state: BidFlowState;
  placeBid: (offeringId: string, input: BidInput) => Promise<void>;
  sign: () => Promise<void>;
  retry: () => void;
  reconcile: () => Promise<void>;
  reset: () => void;
}

// Retry disposition for a prepare-time backend rejection. Band/count errors + transient transport blips are
// re-preparable (fix the input / try again); window/whitelist/wallet/not-found are terminal for this hook
// (the panel/gate handles them), so → 'none'.
function prepareRetry(code: BidErrorCode): 'reprepare' | 'none' {
  switch (code) {
    case 'BID_BELOW_LOW_PRICE':
    case 'BID_ABOVE_HIGH_PRICE':
    case 'BID_COUNT_EXCEEDS_FLOAT':
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'SERVER_ERROR':
      return 'reprepare';
    default:
      return 'none';
  }
}

export function useBidFlow(): UseBidFlowReturn {
  const [state, setStateRaw] = useState<BidFlowState>({ status: 'idle' });
  const stateRef = useRef<BidFlowState>(state);
  const busyRef = useRef(false); // single-flights the whole prepare→sign→submit sequence (AC-14)
  const cancelledRef = useRef(false);

  const keyRef = useRef<string | null>(null); // current idempotency key (SEC-4)
  const dataRef = useRef<PrepareBidData | null>(null); // last prepare envelope (for 'resign')
  const offeringIdRef = useRef<string | null>(null);

  const setState = useCallback((next: BidFlowState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  // Stop in-flight async work (prepare/sign/submit/reconcile) from updating state after unmount.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Reconcile a possibly-lost submit with exactly ONE getMyBid read (never a resubmit, never a loop — AC-11).
  // A bid exists → adopt it and hand off to the poll; SESSION_EXPIRED → re-auth; anything else → recheck.
  // Always keeps the idempotency key (cleared explicitly on MISMATCH/CHALLENGE_EXPIRED/reprepare, never here —
  // todo 151 dropped a dead `keepKey` flag every caller set to true).
  const reconcileOnce = useCallback(
    async (offeringId: string) => {
      const res = await refreshMyBidAction(offeringId);
      if (cancelledRef.current) return;
      if (res.status === 'success' && res.bid) {
        setState({ status: 'submitted', bid: res.bid });
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
    async (res: SubmitBidResult, offeringId: string) => {
      if (res.status === 'success') {
        setState({ status: 'submitted', bid: res.bid });
        return;
      }
      switch (res.code) {
        case 'NETWORK_ERROR':
          // A drop after dispatch may have still landed — reconcile, never blind-resubmit (AC-11). Keep the
          // key so any surviving in-flight submit stays deduplicated.
          setState({ status: 'reconciling' });
          await reconcileOnce(offeringId);
          return;
        case 'IDEMPOTENCY_KEY_IN_FLIGHT':
          // The same key is mid-processing server-side — reconcile and KEEP the key (AC-16).
          setState({ status: 'reconciling' });
          await reconcileOnce(offeringId);
          return;
        case 'IDEMPOTENCY_KEY_MISMATCH':
          keyRef.current = null; // fresh key on the next placeBid (AC-16 / SEC-4)
          setState({
            status: 'error',
            code: 'IDEMPOTENCY_KEY_MISMATCH',
            message: OFFERINGS_MESSAGES.IDEMPOTENCY_KEY_MISMATCH,
            retry: 'reprepare',
          });
          return;
        case 'BID_CHALLENGE_EXPIRED':
          keyRef.current = null; // stale challenge → fresh key + re-prepare (AC-15a)
          setState({
            status: 'error',
            code: 'BID_CHALLENGE_EXPIRED',
            message: OFFERINGS_MESSAGES.BID_CHALLENGE_EXPIRED,
            retry: 'reprepare',
          });
          return;
        case 'OFFERING_WINDOW_CLOSED':
        case 'OFFERING_NOT_OPEN':
          // Signed but too late — the window closed before confirmation; no funds moved, no re-prepare (AC-12).
          setState({
            status: 'error',
            code: res.code,
            message: OFFERINGS_MESSAGES[res.code],
            retry: 'none',
          });
          return;
        case 'SESSION_EXPIRED':
          setState({ status: 'sessionExpired' });
          return;
        default:
          setState({
            status: 'error',
            code: res.code,
            message: OFFERINGS_MESSAGES[res.code],
            retry: 'reprepare',
          });
      }
    },
    [setState, reconcileOnce],
  );

  const applyPrepareError = useCallback(
    (res: Extract<PrepareBidResult, { status: 'error' }>) => {
      if (res.code === 'BID_INSUFFICIENT_BALANCE') {
        // Carry the Zod-validated required/available so the panel can enrich the curated copy (SEC-7); never
        // surface a raw backend message.
        setState({
          status: 'insufficientBalance',
          required: res.required,
          available: res.available,
          message: OFFERINGS_MESSAGES.BID_INSUFFICIENT_BALANCE,
        });
        return;
      }
      if (res.code === 'SESSION_EXPIRED') {
        setState({ status: 'sessionExpired' });
        return;
      }
      setState({
        status: 'error',
        code: res.code,
        message: OFFERINGS_MESSAGES[res.code],
        retry: prepareRetry(res.code),
      });
    },
    [setState],
  );

  const placeBid = useCallback(
    async (offeringId: string, input: BidInput) => {
      if (busyRef.current) return; // single-flight: a double-click fires exactly one prepare (AC-14)
      busyRef.current = true;
      offeringIdRef.current = offeringId;
      const key = mintIdempotencyKey();
      keyRef.current = key;
      setState({ status: 'preparing' });
      try {
        const res = await prepareBidAction(offeringId, input, key);
        if (cancelledRef.current) return;

        if (res.status === 'error') {
          applyPrepareError(res);
          return;
        }

        // SEC-5 amount-authority gate: the client-computed escrow MUST equal the server quote, else re-prepare
        // rather than sign an amount the user didn't see. Both sides are normalized through BigInt→string so a
        // non-canonical server serialization (e.g. leading zeros) can't falsely trip the mismatch (todo 153).
        if (
          escrowAmount(input.price, input.count) !== BigInt(res.data.escrowAmountStroops).toString()
        ) {
          keyRef.current = null;
          setState({
            status: 'error',
            code: 'SERVER_ERROR',
            message: OFFERINGS_MESSAGES.SERVER_ERROR,
            retry: 'reprepare',
          });
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
    const offeringId = offeringIdRef.current;
    const key = keyRef.current;
    try {
      if (!offeringId || !key) {
        setState({
          status: 'error',
          code: 'SERVER_ERROR',
          message: OFFERINGS_MESSAGES.SERVER_ERROR,
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
          timeoutMs: BID_ASSERTION_TIMEOUT_MS,
        }),
      );
      if (cancelledRef.current) return;

      if (assertion.status === 'cancelled') {
        setState({ status: 'readyToSign', data }); // recoverable, no auto-retry (AC-18)
        return;
      }
      if (assertion.status === 'error') {
        // A hard passkey failure (distinct from a dismiss/timeout `cancelled`) → its own copy, resignable
        // since the challenge wasn't consumed (todo 154).
        setState({
          status: 'error',
          code: 'PASSKEY_FAILED',
          message: OFFERINGS_MESSAGES.PASSKEY_FAILED,
          retry: 'resign',
        });
        return;
      }

      // Extract the base64url assertion fields verbatim (SEC-6 — passed through, never parsed for trust) and
      // echo the prepared txXdr exactly.
      const submitInput: SubmitBidInput = {
        txXdr: data.txXdr,
        credentialId: assertion.response.id,
        authenticatorData: assertion.response.response.authenticatorData,
        clientDataJSON: assertion.response.response.clientDataJSON,
        signature: assertion.response.response.signature,
      };

      setState({ status: 'submitting' });
      const res = await submitBidAction(offeringId, submitInput, key);
      if (cancelledRef.current) return;
      await handleSubmitResult(res, offeringId);
    } finally {
      busyRef.current = false;
    }
  }, [setState, handleSubmitResult]);

  // Manual reconcile from `recheck` (the "couldn't confirm" state) — one more getMyBid read, key kept.
  const reconcile = useCallback(async () => {
    if (busyRef.current) return;
    if (stateRef.current.status !== 'recheck') return;
    const offeringId = offeringIdRef.current;
    if (!offeringId) return;
    busyRef.current = true;
    try {
      setState({ status: 'reconciling' });
      await reconcileOnce(offeringId);
    } finally {
      busyRef.current = false;
    }
  }, [setState, reconcileOnce]);

  // Recover from a non-terminal failure surface. 'reprepare' drops the key + returns to idle so the user
  // re-enters/re-places (a fresh key is minted on the next placeBid); 'resign' returns to readyToSign if the
  // prepare envelope is still in hand.
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
    if (current.status === 'insufficientBalance') {
      // (todo 152) `recheck` is recovered via reconcile(), never retry() — so no recheck arm here.
      keyRef.current = null;
      setState({ status: 'idle' });
    }
  }, [setState]);

  const reset = useCallback(() => {
    busyRef.current = false;
    keyRef.current = null;
    dataRef.current = null;
    setState({ status: 'idle' });
  }, [setState]);

  return { state, placeBid, sign, retry, reconcile, reset };
}
