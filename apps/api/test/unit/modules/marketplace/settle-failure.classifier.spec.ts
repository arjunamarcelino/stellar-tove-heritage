import { describe, it, expect } from 'vitest';
import { classifySettleFailure } from '@modules/marketplace/settlement/settle/settle-failure.classifier';
import { SETTLE_FAILURE_REASONS } from '@modules/marketplace/settlement/settle/settle-failure.constant';

/** The money-safety failure taxonomy (TOV-177): seller-fault → expire; buyer/ambiguous → keepOpen; unknown → retry. */
describe('classifySettleFailure', () => {
  it('seller-fault reverts expire the quote', () => {
    expect(classifySettleFailure({ status: 'REVERTED', contractCode: 100 })).toEqual({ terminal: true, reason: 'seller_balance_insufficient', quoteDisposition: 'expire' });
    expect(classifySettleFailure({ status: 'REVERTED', contractCode: 7 })).toEqual({ terminal: true, reason: 'seller_lockup', quoteDisposition: 'expire' });
    expect(classifySettleFailure({ status: 'REVERTED', contractCode: 8 }).quoteDisposition).toBe('expire');
  });

  it('buyer/ambiguous reverts keep the quote open', () => {
    expect(classifySettleFailure({ status: 'REVERTED', contractCode: 6 })).toEqual({ terminal: true, reason: 'party_frozen', quoteDisposition: 'keepOpen' });
    expect(classifySettleFailure({ status: 'REVERTED', contractCode: 5 }).reason).toBe('buyer_not_whitelisted');
    expect(classifySettleFailure({ status: 'RELAYER_FAILED', reason: 'expired' })).toEqual({ terminal: true, reason: 'buyer_signature_expired', quoteDisposition: 'keepOpen' });
    expect(classifySettleFailure({ status: 'RELAYER_FAILED', reason: 'expired', expiredParty: 'buyer' })).toEqual({ terminal: true, reason: 'buyer_signature_expired', quoteDisposition: 'keepOpen' });
    expect(classifySettleFailure({ status: 'RELAYER_FAILED', reason: 'transfer_failed' }).reason).toBe('settlement_reverted');
  });

  it('a lapsed SELLER auth expires the quote (#389)', () => {
    expect(classifySettleFailure({ status: 'RELAYER_FAILED', reason: 'expired', expiredParty: 'seller' })).toEqual({ terminal: true, reason: 'seller_auth_lapsed', quoteDisposition: 'expire' });
  });

  it('transient outcomes are RETRYABLE (fail-closed); a deterministic REVERTED is terminal keepOpen (#383)', () => {
    expect(classifySettleFailure({ status: 'RELAYER_FAILED', reason: 'unavailable' })).toEqual({ terminal: false });
    expect(classifySettleFailure({ status: 'REVERTED', contractCode: 11 })).toEqual({ terminal: false }); // migration pending = only transient code
    // An unrecognized / cross-contract / null contract code is a DETERMINISTIC revert: terminal keepOpen (never
    // retry-forever, never expire the seller for a code we can't prove is seller-fault).
    expect(classifySettleFailure({ status: 'REVERTED', contractCode: 999 })).toEqual({ terminal: true, reason: 'settlement_reverted', quoteDisposition: 'keepOpen' });
    expect(classifySettleFailure({ status: 'REVERTED', contractCode: null })).toEqual({ terminal: true, reason: 'settlement_reverted', quoteDisposition: 'keepOpen' });
  });

  it('every mapped reason is in the closed set and fits the varchar(48) columns', () => {
    for (const r of SETTLE_FAILURE_REASONS) expect(r.length).toBeLessThanOrEqual(48);
  });
});
