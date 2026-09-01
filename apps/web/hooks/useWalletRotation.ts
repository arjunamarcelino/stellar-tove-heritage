'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startPasskeyAssertion, buildAssertionOptions } from '@/lib/webauthn/passkey';
import { ROTATION_MESSAGES, classifyTransferItemCode } from '@/lib/wallet/rotationMessages';
import { deriveSettlementOutcome, countConfirmed } from '@/lib/wallet/settlementOutcome';
import {
  rotateInitiateAction,
  rotateSubmitAction,
  rotateStatusAction,
  rotateCancelAction,
  getCurrentLedgerAction,
} from '@/app/actions/walletRotate';
import { setPrimaryWalletAction } from '@/app/actions/walletManage';
import { delay } from '@/lib/async';
import type {
  WalletRotationState,
  UseWalletRotationReturn,
  RotationDestination,
  RotationBeginData,
  RotationItem,
  RotationItemStatusDetail,
  RotationStatusData,
  SignedRotationItem,
  WalletSummary,
} from '@/lib/types/api';

const BATCH_SIZE = 4; // ≤5 — bounds the sign→submit gap vs each item's expiresAtLedger
const ASSERTION_TIMEOUT_MS = 120_000; // generous — cross-device (QR/hybrid) signing is slow
const POLL_INTERVAL_MS = 5_000; // aligned to ~5s ledger-close; ~40% of the status 30/min throttle
const STALL_THRESHOLD = 6; // consecutive no-progress polls (~30s) before we stop waiting
const POLL_CEILING_MS = 10 * 60_000; // absolute wall-clock backstop → settlementUnknown (never failure)
const MAX_ROUNDS = 12; // rebuild-round safety net
const MAX_NO_PROGRESS_ROUNDS = 3; // stop rebuilding after N rounds that confirm nothing new

// Resolve immediately when the tab is visible, else park until the next `visibilitychange` reveals it (or
// the poll aborts). Lets the status poll pause while the tab is hidden — matching the sibling polling hooks
// (useTradePolling / useMyBidPolling / useWhitelistStatusPolling) — so a backgrounded tab stops hitting the
// throttled status endpoint. The loop's own 5s delay rate-limits the resume, so no un-hide debounce needed.
function waitForVisible(signal: AbortSignal): Promise<void> {
  if (typeof document === 'undefined' || !document.hidden) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    const cleanup = () => {
      document.removeEventListener('visibilitychange', onVisible);
      signal.removeEventListener('abort', onAbort);
    };
    const onVisible = () => {
      if (!document.hidden) {
        cleanup();
        resolve();
      }
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    };
    document.addEventListener('visibilitychange', onVisible);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Correlate the initiate items' display fields into the status items by itemId — the status endpoint
// carries only itemId/contract/amount/status. (N fractions can share a tokenContract, so correlation
// MUST be by itemId, never tokenContract.)
function enrichByItemId(
  items: RotationItemStatusDetail[],
  beginItems: RotationItem[],
): RotationItemStatusDetail[] {
  const byId = new Map(beginItems.map((i) => [i.itemId, i]));
  return items.map((item) => {
    const b = byId.get(item.itemId);
    return b ? { ...item, displayName: b.displayName, decimals: b.decimals } : item;
  });
}

type PollResult =
  | { kind: 'settled'; data: RotationStatusData; confirmedCount: number; total: number }
  | { kind: 'unknown'; confirmedCount: number; total: number };

// Drives the rotation wizard: choose destination → auto set-primary → initiate/review → per-item passkey
// signing loop (batched) → submit → poll/reconcile. Non-atomic N-transfer, so partial settlement and a
// resumable/paused mid-loop are first-class. NO client idempotency key — the server nonce + one-way latch
// make re-submission safe; a lost response lands in `settlementUnknown` and reconciles via status.
export function useWalletRotation(
  sourceWalletId: string,
  wallets: WalletSummary[],
  initialStatus: RotationStatusData | null,
): UseWalletRotationReturn {
  const [state, setStateRaw] = useState<WalletRotationState>(() =>
    initialStatus && initialStatus.state !== 'none'
      ? { status: 'loading' }
      : { status: 'selectingDestination', wallets },
  );
  const stateRef = useRef(state);
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  // The latest initiate response (fresh challenges for the not-yet-confirmed items).
  const beginRef = useRef<RotationBeginData | null>(null);

  const setState = useCallback((next: WalletRotationState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      pollAbortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    busyRef.current = false;
    pollAbortRef.current?.abort();
    beginRef.current = null;
    setState({ status: 'selectingDestination', wallets });
  }, [setState, wallets]);

  const transferring = useCallback(
    (
      phase: 'signing' | 'submitting' | 'polling' | 'rebuilding',
      destination: RotationDestination,
      confirmedCount: number,
      total: number,
    ): WalletRotationState => ({
      status: 'transferring',
      phase,
      confirmedCount,
      total,
      destination,
    }),
    [],
  );

  // Poll status until the item set reaches a terminal shape (no in-flight items), a stall, or the
  // wall-clock ceiling. Streams live progress via setState; returns the last known counts either way.
  const pollToRest = useCallback(
    async (destination: RotationDestination, fallbackTotal: number): Promise<PollResult> => {
      const controller = new AbortController();
      pollAbortRef.current = controller;
      const { signal } = controller;
      const startedAt = Date.now();
      let lastConfirmed = -1;
      let stalled = 0;
      let confirmed = 0;
      let total = fallbackTotal;

      for (;;) {
        if (signal.aborted || cancelledRef.current)
          return { kind: 'unknown', confirmedCount: confirmed, total };
        // Pause polling while the tab is hidden; resume on the next reveal (bounded by the 5s delay below).
        try {
          await waitForVisible(signal);
        } catch {
          return { kind: 'unknown', confirmedCount: confirmed, total };
        }
        if (signal.aborted || cancelledRef.current)
          return { kind: 'unknown', confirmedCount: confirmed, total };
        const status = await rotateStatusAction(sourceWalletId);
        if (signal.aborted || cancelledRef.current)
          return { kind: 'unknown', confirmedCount: confirmed, total };

        // SESSION_EXPIRED / transport error mid-poll → we can't safely keep polling; reconcile later.
        if (status.status === 'error') return { kind: 'unknown', confirmedCount: confirmed, total };

        const items = enrichByItemId(status.data.items, beginRef.current?.items ?? []);
        confirmed = countConfirmed(items);
        total = items.length || fallbackTotal;
        setState(transferring('polling', destination, confirmed, total));

        if (deriveSettlementOutcome(items) !== 'inflight') {
          return { kind: 'settled', data: status.data, confirmedCount: confirmed, total };
        }

        // Liveness: progress = confirmed count rising. Reset the stall counter on any new confirmation.
        if (confirmed > lastConfirmed) {
          lastConfirmed = confirmed;
          stalled = 0;
        } else {
          stalled += 1;
        }
        if (stalled >= STALL_THRESHOLD || Date.now() - startedAt >= POLL_CEILING_MS) {
          return { kind: 'unknown', confirmedCount: confirmed, total };
        }

        try {
          await delay(POLL_INTERVAL_MS, signal);
        } catch {
          return { kind: 'unknown', confirmedCount: confirmed, total };
        }
      }
    },
    [sourceWalletId, setState, transferring],
  );

  // Sign one batch of items (serially — one WebAuthn ceremony at a time) and submit it.
  const signAndSubmitBatch = useCallback(
    async (
      batch: RotationItem[],
      destination: RotationDestination,
      confirmedCount: number,
      total: number,
    ): Promise<'ok' | 'cancelled' | 'error'> => {
      const signed: SignedRotationItem[] = [];
      for (const item of batch) {
        if (cancelledRef.current) return 'cancelled';
        setState(transferring('signing', destination, confirmedCount, total));
        const assertion = await startPasskeyAssertion(
          buildAssertionOptions({
            challenge: item.challenge,
            credentialId: item.credentialId,
            rpId: item.rpId,
            transports: item.transports,
            timeoutMs: ASSERTION_TIMEOUT_MS,
          }),
        );
        if (assertion.status === 'cancelled') return 'cancelled';
        if (assertion.status === 'error') return 'error';
        // Build EXACTLY the DTO fields — never spread the raw credential (forbidNonWhitelisted).
        signed.push({
          itemId: item.itemId,
          authenticatorData: assertion.response.response.authenticatorData,
          clientDataJSON: assertion.response.response.clientDataJSON,
          signature: assertion.response.response.signature,
        });
      }

      if (cancelledRef.current) return 'cancelled';
      setState(transferring('submitting', destination, confirmedCount, total));
      const submit = await rotateSubmitAction(sourceWalletId, signed);
      // A network drop after dispatch may have still broadcast — treat all submit errors as unknown
      // (reconcile via status), never blind-resubmit.
      return submit.status === 'error' ? 'error' : 'ok';
    },
    [sourceWalletId, setState, transferring],
  );

  // The batched sign → submit → poll → (rebuild) loop. Assumes beginRef.current holds fresh challenges.
  const drive = useCallback(
    async (destination: RotationDestination, initialConfirmed: number): Promise<void> => {
      let prevConfirmed = initialConfirmed;
      let noProgressRounds = 0;
      // The authoritative grand total N (from the full status set), carried out of the loop so the
      // rounds-exhausted branch below reports "X of N", not "X of X".
      let lastTotal = initialConfirmed;

      for (let round = 0; round < MAX_ROUNDS; round++) {
        // Proactive freshness check (optional, fail-soft): if the current ledger is known and any challenge
        // has already expired (e.g. the user lingered on review or a slow cross-device sign), rebuild fresh
        // challenges via initiate BEFORE signing — so we don't burn a passkey ceremony on a stale challenge
        // that the backend would just reject as TRANSFER_EXPIRED. A null ledger read skips the check.
        const currentLedger = await getCurrentLedgerAction();
        if (cancelledRef.current) return;
        const pending = beginRef.current;
        if (
          currentLedger !== null &&
          pending &&
          pending.items.some((i) => i.expiresAtLedger <= currentLedger)
        ) {
          const refreshed = await rotateInitiateAction(sourceWalletId, destination.id);
          if (cancelledRef.current) return;
          if (refreshed.status === 'success') beginRef.current = refreshed.data;
          // On a refresh error, fall through and try with the challenges we have (fail-soft).
        }

        const begin = beginRef.current;
        if (!begin || begin.items.length === 0) break;
        const roundTotal = prevConfirmed + begin.items.length;

        for (const batch of chunk(begin.items, BATCH_SIZE)) {
          if (cancelledRef.current) return;
          const outcome = await signAndSubmitBatch(batch, destination, prevConfirmed, roundTotal);
          if (cancelledRef.current) return;
          if (outcome === 'cancelled') {
            const status = await rotateStatusAction(sourceWalletId);
            const confirmed =
              status.status === 'success' ? countConfirmed(status.data.items) : prevConfirmed;
            const total = status.status === 'success' ? status.data.items.length : roundTotal;
            // ≥1 confirmed → can't return to a clean review; pause and let the user resume the rest.
            if (confirmed > 0)
              setState({ status: 'paused', confirmedCount: confirmed, total, destination });
            else setState({ status: 'reviewing', destination, items: begin.items });
            return;
          }
          if (outcome === 'error') {
            // A submit error may have still broadcast (or a prior batch is in flight) → outcome unknown;
            // reconcile via status, never blind-resubmit. Money-safe: never claims a false move/failure.
            // (A clean pre-submit passkey error is also mapped here; it reads as "unsure" but the "Check
            // status" resume resolves it to the true state — acceptable over risking a wrong terminal.)
            setState({
              status: 'settlementUnknown',
              confirmedCount: prevConfirmed,
              total: roundTotal,
              destination,
            });
            return;
          }
        }

        const poll = await pollToRest(destination, roundTotal);
        if (cancelledRef.current) return;
        if (poll.kind === 'unknown') {
          setState({
            status: 'settlementUnknown',
            confirmedCount: poll.confirmedCount,
            total: poll.total,
            destination,
          });
          return;
        }

        const items = enrichByItemId(poll.data.items, begin.items);
        const confirmed = poll.confirmedCount;
        const total = poll.total;
        lastTotal = total;

        if (deriveSettlementOutcome(items) === 'complete') {
          setState({ status: 'complete', destination, movedCount: confirmed });
          return;
        }

        const retryable = items.filter(
          (i) => i.status !== 'confirmed' && classifyTransferItemCode(i.errorCode).retryable,
        );
        noProgressRounds = confirmed > prevConfirmed ? 0 : noProgressRounds + 1;
        prevConfirmed = confirmed;

        if (retryable.length === 0 || noProgressRounds >= MAX_NO_PROGRESS_ROUNDS) {
          // Terminal. `error` ⇒ nothing moved (invariant) — anything that moved routes to `partial`.
          if (confirmed > 0)
            setState({ status: 'partial', items, confirmedCount: confirmed, total, destination });
          else
            setState({
              status: 'error',
              code: 'SERVER_ERROR',
              message: ROTATION_MESSAGES.SERVER_ERROR,
            });
          return;
        }

        // Rebuild fresh challenges for the remaining items and go again.
        setState(transferring('rebuilding', destination, confirmed, total));
        const reinit = await rotateInitiateAction(sourceWalletId, destination.id);
        if (cancelledRef.current) return;
        if (reinit.status === 'error') {
          if (confirmed > 0)
            setState({ status: 'partial', items, confirmedCount: confirmed, total, destination });
          else setState({ status: 'error', code: reinit.code, message: reinit.message });
          return;
        }
        beginRef.current = reinit.data;
      }

      // Rounds exhausted — reconcile-later. Use the authoritative grand total, not the confirmed count.
      setState({
        status: 'settlementUnknown',
        confirmedCount: prevConfirmed,
        total: lastTotal,
        destination,
      });
    },
    [sourceWalletId, setState, transferring, signAndSubmitBatch, pollToRest],
  );

  // Choose W2: set it primary (idempotent no-op if already primary), then initiate to fetch the review
  // items + challenges. Lockup / not-allowlisted surface as a blocked review (Confirm disabled).
  const chooseDestination = useCallback(
    async (destination: RotationDestination) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        setState({ status: 'loading' });

        const primary = await setPrimaryWalletAction(destination.id);
        if (cancelledRef.current) return;
        if (primary.status === 'error') {
          setState({
            status: 'error',
            code: primary.code === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' : 'SERVER_ERROR',
            message: primary.message,
          });
          return;
        }

        const init = await rotateInitiateAction(sourceWalletId, destination.id);
        if (cancelledRef.current) return;

        if (init.status === 'error') {
          if (init.code === 'ROTATION_BLOCKED_BY_LOCKUP') {
            setState({
              status: 'reviewing',
              destination,
              items: [],
              blocked: {
                code: 'ROTATION_BLOCKED_BY_LOCKUP',
                lockupExpiresAt: init.lockupExpiresAt,
              },
            });
          } else if (init.code === 'RECIPIENT_NOT_WHITELISTED') {
            setState({
              status: 'reviewing',
              destination,
              items: [],
              blocked: { code: 'RECIPIENT_NOT_WHITELISTED', message: init.message },
            });
          } else {
            setState({ status: 'error', code: init.code, message: init.message });
          }
          return;
        }

        beginRef.current = init.data;
        setState({ status: 'reviewing', destination, items: init.data.items });
      } finally {
        busyRef.current = false;
      }
    },
    [sourceWalletId, setState],
  );

  const confirmAndTransfer = useCallback(async () => {
    if (busyRef.current) return;
    const current = stateRef.current;
    if (current.status !== 'reviewing' || current.blocked || current.items.length === 0) return;
    busyRef.current = true;
    try {
      await drive(current.destination, 0);
    } finally {
      busyRef.current = false;
    }
  }, [drive]);

  // Rehydrate an in-flight rotation from status: if confirmed → complete; else re-initiate the remaining
  // items and resume the drive loop. Confirmed items are never re-signed (initiate omits them).
  const resume = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const status = await rotateStatusAction(sourceWalletId);
      if (cancelledRef.current) return;
      if (status.status === 'error') {
        // A transient status-read failure isn't "nothing moved". If we were already showing partial
        // progress, preserve it as settlementUnknown (reconcile-later) rather than dropping to a countless
        // `error` (which claims nothing moved). Only a cold entry with no prior context → error.
        const cur = stateRef.current;
        if (
          cur.status === 'paused' ||
          cur.status === 'partial' ||
          cur.status === 'settlementUnknown'
        ) {
          setState({
            status: 'settlementUnknown',
            confirmedCount: cur.confirmedCount,
            total: cur.total,
            destination: cur.destination,
          });
        } else {
          setState({ status: 'error', code: status.code, message: status.message });
        }
        return;
      }
      const data = status.data;
      if (data.state === 'none') {
        setState({ status: 'selectingDestination', wallets });
        return;
      }
      const destination: RotationDestination = {
        id: data.destinationWalletId,
        address: data.destinationAddress,
      };
      const confirmed = countConfirmed(data.items);
      if (deriveSettlementOutcome(data.items) === 'complete') {
        setState({ status: 'complete', destination, movedCount: confirmed });
        return;
      }
      setState(transferring('rebuilding', destination, confirmed, data.items.length));
      const init = await rotateInitiateAction(sourceWalletId, destination.id);
      if (cancelledRef.current) return;
      if (init.status === 'error') {
        // We already know `confirmed` fractions moved — mirror drive()'s invariant: `error` means nothing
        // moved, so anything already confirmed routes to settlementUnknown (reconcile-later), NOT error.
        if (confirmed > 0) {
          setState({
            status: 'settlementUnknown',
            confirmedCount: confirmed,
            total: data.items.length,
            destination,
          });
        } else {
          setState({ status: 'error', code: init.code, message: init.message });
        }
        return;
      }
      beginRef.current = init.data;
      busyRef.current = false; // drive manages its own re-entrancy
      await drive(destination, confirmed);
    } finally {
      busyRef.current = false;
    }
  }, [sourceWalletId, setState, transferring, wallets, drive]);

  const cancel = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const result = await rotateCancelAction(sourceWalletId);
      if (cancelledRef.current) return;
      if (result.status === 'success') {
        beginRef.current = null;
        setState({ status: 'selectingDestination', wallets });
        return;
      }
      // 409 → an item is already in-flight/confirmed; reconcile via resume rather than error.
      if (result.code === 'ROTATION_CANNOT_CANCEL') {
        busyRef.current = false;
        await resume();
        return;
      }
      // 404 → nothing to cancel; just leave the flow.
      setState({ status: 'selectingDestination', wallets });
    } finally {
      busyRef.current = false;
    }
  }, [sourceWalletId, setState, wallets, resume]);

  return { state, chooseDestination, confirmAndTransfer, resume, cancel, reset };
}
