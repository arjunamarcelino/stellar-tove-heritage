import { describe, it, expect } from 'vitest';
import { failureAffordance } from '@/components/accept/affordance';
import { FAILURE_REASON_COPY } from '@/lib/accept/acceptMessages';
import type { TradeFailureReason } from '@/lib/types/api';

describe('failureAffordance', () => {
  it('seller-fault reasons → accept-another (quote expired)', () => {
    expect(failureAffordance('seller_balance_insufficient').kind).toBe('accept-another');
    expect(failureAffordance('seller_lockup').kind).toBe('accept-another');
    expect(failureAffordance('seller_auth_lapsed').kind).toBe('accept-another');
  });

  it('buyer/ambiguous reasons → re-accept (quote stays open)', () => {
    expect(failureAffordance('buyer_signature_expired').kind).toBe('re-accept');
    expect(failureAffordance('party_frozen').kind).toBe('re-accept');
    expect(failureAffordance('settlement_reverted').kind).toBe('re-accept');
    // Added from the shipped set (PR #49) — both re-accept.
    expect(failureAffordance('buyer_usdc_insufficient').kind).toBe('re-accept');
    expect(failureAffordance('settle_abandoned').kind).toBe('re-accept');
  });

  it('invalid_trade / token_not_found → alert', () => {
    expect(failureAffordance('invalid_trade').kind).toBe('alert');
    expect(failureAffordance('token_not_found').kind).toBe('alert');
  });

  it('unknown or null → safe re-accept default', () => {
    expect(failureAffordance('unknown').kind).toBe('re-accept');
    expect(failureAffordance(null).kind).toBe('re-accept');
  });

  it('every reason has curated copy', () => {
    const reasons = Object.keys(FAILURE_REASON_COPY) as TradeFailureReason[];
    for (const r of reasons) expect(FAILURE_REASON_COPY[r]).toBeTruthy();
  });
});
