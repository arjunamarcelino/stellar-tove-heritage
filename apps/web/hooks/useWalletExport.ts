'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startPasskeyAssertion, buildAssertionOptions } from '@/lib/webauthn/passkey';
import { makeTargetAddressSchema } from '@/lib/wallet/schemas';
import { EXPORT_MESSAGES } from '@/lib/wallet/exportMessages';
import {
  exportBeginAction,
  exportSubmitAction,
  exportStatusAction,
} from '@/app/actions/walletExport';
import { delay } from '@/lib/async';
import { deriveSettlementOutcome } from '@/lib/wallet/settlementOutcome';
import type {
  WalletExportState,
  UseWalletExportReturn,
  SignedExportItem,
  ExportItem,
  ExportItemStatusDetail,
} from '@/lib/types/api';

const ASSERTION_TIMEOUT_MS = 120_000; // generous — cross-device (QR/hybrid) signing is slow
const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 20; // ~1 minute of reconciliation before we surface settlementUnknown

// Merge the export-begin items' display fields (name/amount/asset) into the status-endpoint items by
// tokenContract, so the partial/success screens can render "USDC 10.00" / the fraction name (todo
// 068/069). The status endpoint carries only tokenContract/tokenKind/status/txHash.
function enrichStatusItems(
  items: ExportItemStatusDetail[],
  beginItems: ExportItem[],
): ExportItemStatusDetail[] {
  const byContract = new Map(beginItems.map((i) => [i.tokenContract, i]));
  return items.map((item) => {
    const b = byContract.get(item.tokenContract);
    return b
      ? {
          ...item,
          displayName: b.displayName,
          assetCode: b.assetCode,
          amountScaled: b.amountScaled,
          decimals: b.decimals,
        }
      : item;
  });
}

// Drives the export wizard: address entry → per-item passkey signing loop → submit → reconcile.
// Export is N single-token transfers (non-atomic), so signing is a loop and partial settlement is a
// first-class outcome. There is no client idempotency key — the backend nonce + one-way latch make
// resubmission safe; a lost response after submit lands in `settlementUnknown` and reconciles via the
// status endpoint (never a blind re-submit).
export function useWalletExport(walletId: string, ownAddress: string): UseWalletExportReturn {
  const [state, setStateRaw] = useState<WalletExportState>({ status: 'idle' });
  const stateRef = useRef(state);
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);
  // Aborts the in-flight reconcile poll on unmount/reset so its timer doesn't dangle (todo 070).
  const reconcileAbortRef = useRef<AbortController | null>(null);

  const setState = useCallback((next: WalletExportState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  // Stop in-flight async work (poll loop / signing) from updating state after unmount.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      reconcileAbortRef.current?.abort();
    };
  }, []);

  const start = useCallback(() => setState({ status: 'educating' }), [setState]);
  const acknowledgeEducation = useCallback(
    () => setState({ status: 'enteringAddress' }),
    [setState],
  );
  const backToAddress = useCallback(() => setState({ status: 'enteringAddress' }), [setState]);
  const reset = useCallback(() => {
    busyRef.current = false;
    reconcileAbortRef.current?.abort();
    setState({ status: 'idle' });
  }, [setState]);

  const submitAddress = useCallback(
    async (targetAddress: string) => {
      if (busyRef.current) return;

      const trimmed = targetAddress.trim();
      const parsed = makeTargetAddressSchema(ownAddress).safeParse(trimmed);
      if (!parsed.success) {
        setState({ status: 'enteringAddress', inlineError: parsed.error.issues[0]?.message });
        return;
      }

      busyRef.current = true;
      setState({ status: 'checkingAddress' });
      try {
        const result = await exportBeginAction(walletId, parsed.data);
        if (cancelledRef.current) return;

        if (result.status === 'error') {
          // Whitelist / validation route back to the address step with an inline error; everything
          // else (already-exported, wallet gone, session) is terminal.
          if (result.code === 'RECIPIENT_NOT_WHITELISTED' || result.code === 'VALIDATION_FAILED') {
            setState({ status: 'enteringAddress', inlineError: result.message });
          } else {
            setState({
              status: 'error',
              code: result.code,
              message: result.message,
            });
          }
          return;
        }

        setState({ status: 'confirming', data: result.data });
      } finally {
        busyRef.current = false;
      }
    },
    [ownAddress, walletId, setState],
  );

  const reconcile = useCallback(
    async (beginItems: ExportItem[]) => {
      const controller = new AbortController();
      reconcileAbortRef.current = controller;
      const { signal } = controller;

      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        if (signal.aborted) return;
        const result = await exportStatusAction(walletId);
        if (signal.aborted) return;

        if (result.status === 'success') {
          const { state: exportState, selfCustodyAddress } = result.data;
          // Enrich the status items with the begin items' display fields (name/amount) by tokenContract.
          const items = enrichStatusItems(result.data.items, beginItems);
          if (exportState === 'confirmed') {
            setState({ status: 'success', selfCustodyAddress, items });
            return;
          }
          if (exportState === 'failed') {
            // Derive the outcome from the full item set, not just the aggregate label (todo 068), via the
            // shared money-safe classifier (TOV-48 #259): any confirmed → partial; any still-in-flight →
            // we can't yet claim "nothing moved" → settlementUnknown; only all-terminally-failed → a clean
            // "nothing moved" error.
            const outcome = deriveSettlementOutcome(items);
            if (outcome === 'inflight') {
              setState({ status: 'settlementUnknown' });
            } else if (outcome === 'failed') {
              // The dialog's error screen states "nothing was moved"; keep the base copy from the single
              // source of truth (todo 071), don't fork it.
              setState({
                status: 'error',
                code: 'TRANSFER_FAILED',
                message: EXPORT_MESSAGES.TRANSFER_FAILED,
              });
            } else {
              // complete | partial — at least one item confirmed, so assets moved.
              setState({ status: 'partial', items });
            }
            return;
          }
          // none / pending / submitting → keep waiting
        } else if (result.code === 'SESSION_EXPIRED') {
          // Reconciliation must survive a cold session; a hard 401 is the one thing we can't retry.
          setState({ status: 'settlementUnknown' });
          return;
        }

        try {
          await delay(POLL_INTERVAL_MS, signal);
        } catch {
          return; // aborted (unmount/reset)
        }
      }
      setState({ status: 'settlementUnknown' });
    },
    [walletId, setState],
  );

  const confirmAndSign = useCallback(async () => {
    if (busyRef.current) return;
    const current = stateRef.current;
    if (current.status !== 'confirming') return;

    busyRef.current = true;
    const { data } = current;
    try {
      const signed: SignedExportItem[] = [];
      setState({ status: 'signing', data, signedCount: 0 });

      for (const item of data.items) {
        if (cancelledRef.current) return;
        const assertion = await startPasskeyAssertion(
          buildAssertionOptions({
            challenge: item.challenge,
            credentialId: data.credentialId,
            rpId: data.rpId,
            transports: data.transports,
            timeoutMs: ASSERTION_TIMEOUT_MS,
          }),
        );

        if (assertion.status === 'cancelled') {
          setState({ status: 'confirming', data }); // recoverable — nothing submitted
          return;
        }
        if (assertion.status === 'error') {
          setState({
            status: 'error',
            code: 'PASSKEY_FAILED',
            message: assertion.message,
          });
          return;
        }

        signed.push({
          itemId: item.itemId,
          authenticatorData: assertion.response.response.authenticatorData,
          clientDataJSON: assertion.response.response.clientDataJSON,
          signature: assertion.response.response.signature,
        });
        setState({ status: 'signing', data, signedCount: signed.length });
      }

      setState({ status: 'settling' });
      const submit = await exportSubmitAction(walletId, data.exportId, signed);
      if (cancelledRef.current) return;

      if (submit.status === 'error') {
        // A network drop after dispatch may have still broadcast — reconcile, never blind-resubmit.
        if (submit.code === 'NETWORK_ERROR') {
          setState({ status: 'settlementUnknown' });
        } else {
          setState({
            status: 'error',
            code: submit.code,
            message: submit.message,
          });
        }
        return;
      }

      setState({ status: 'reconciling' });
      await reconcile(data.items);
    } finally {
      busyRef.current = false;
    }
  }, [walletId, setState, reconcile]);

  return {
    state,
    start,
    acknowledgeEducation,
    submitAddress,
    backToAddress,
    confirmAndSign,
    reset,
  };
}
