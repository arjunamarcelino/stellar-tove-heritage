'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { dashboardKeys, offeringKeys } from '@/lib/query-keys';

import { isDeployInFlight, isLatched, latchedAddress } from '../offering-display';
import type { OfferingDetail, OfferingStatus } from '../schemas';

export type ApprovalPanelState =
  | { kind: 'can-approve' }
  | { kind: 'already-approved' }
  | { kind: 'not-a-signer' }
  | { kind: 'deploying' }
  | { kind: 'deployed'; contractAddress: string }
  | { kind: 'deploy-failed' }
  | { kind: 'read-only'; status: OfferingStatus };

export interface DerivePanelOptions {
  /** Sticky: a prior 403 OFFERING_APPROVAL_NOT_A_SIGNER this session. */
  notASigner?: boolean;
}

/**
 * Pure derivation of the panel's mutually-exclusive state. The detail's authoritative `youApproved`
 * (confirmed TOV-154 contract, 2026-08-20) disables the CTA for an admin who already signed; otherwise
 * the CTA is clickable (approve is idempotent + backend-deduped by signer identity). When an older
 * backend omits `youApproved`, it's treated as not-yet-approved (CTA clickable — safe).
 */
export function derivePanelState(
  detail: OfferingDetail,
  opts: DerivePanelOptions = {},
): ApprovalPanelState {
  const { status, escrow } = detail;
  // Authoritative deploy states win over everything (incl. a sticky `notASigner` from an earlier 403):
  // if the escrow latches while a non-signer is watching, show "deployed", not "not an approver".
  const latchAddr = latchedAddress(detail);
  if (latchAddr) return { kind: 'deployed', contractAddress: latchAddr };
  if (escrow.deployStatus === 'failed') return { kind: 'deploy-failed' };
  // `deploying`, the quorum transient, OR `deployed`-without-a-valid-address (eventual consistency) — all
  // render as still-deploying rather than falling through to a terminal read-only panel.
  if (isDeployInFlight(detail) || escrow.deployStatus === 'deployed') return { kind: 'deploying' };
  // Past approval (opened/subscribed/settled/canceled) → read-only, regardless of notASigner.
  if (status !== 'planned') return { kind: 'read-only', status };
  // Planned: a non-signer can't act; an already-signed admin waits; otherwise offer approval.
  if (opts.notASigner) return { kind: 'not-a-signer' };
  if (detail.approvals.youApproved === true) return { kind: 'already-approved' };
  return { kind: 'can-approve' };
}

/**
 * Fires the terminal toast + cache invalidations exactly once per observed transition, and returns the
 * derived panel state. Keys on the LATCHED boolean (the final flip is a `status` change, not a
 * `deployStatus` change) and establishes a silent baseline on first run so opening an already-terminal
 * offering doesn't announce a stale event.
 */
export function useOfferingApprovalLifecycle(
  detail: OfferingDetail | undefined,
  opts: DerivePanelOptions = {},
): { panelState: ApprovalPanelState | null } {
  const queryClient = useQueryClient();

  const latched = detail ? isLatched(detail) : false;
  const deployStatus = detail?.escrow.deployStatus;
  // Ratchet holding the last terminal state ANNOUNCED this mount. 'init' = not yet baselined.
  const announced = useRef<'latched' | 'failed' | null | 'init'>('init');

  useEffect(() => {
    // Establish the baseline from the first REAL payload, never the `undefined` loading state — otherwise
    // opening an already-terminal offering would announce a stale "deployed"/"failed" event.
    if (!detail) return;
    const terminal: 'latched' | 'failed' | null = latched
      ? 'latched'
      : deployStatus === 'failed'
        ? 'failed'
        : null;

    if (announced.current === 'init') {
      announced.current = terminal; // silent baseline
      return;
    }
    // Monotonic: announce only a NEW terminal. A regressing/flapping poll body (terminal → null → terminal)
    // never re-announces, so no duplicate success/error toasts.
    if (terminal !== null && terminal !== announced.current) {
      if (terminal === 'latched') {
        toast.success('Offering approved — escrow deployed');
      } else {
        toast.error('Escrow deploy failed. Any approver can retry.');
      }
      void queryClient.invalidateQueries({ queryKey: offeringKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      announced.current = terminal;
    }
  }, [detail, latched, deployStatus, queryClient]);

  return { panelState: detail ? derivePanelState(detail, opts) : null };
}
