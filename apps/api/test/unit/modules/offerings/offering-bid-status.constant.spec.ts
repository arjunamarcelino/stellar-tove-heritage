import { describe, it, expect } from 'vitest';
import {
  ACTIVE_BID_STATUSES,
  OFFERING_BID_STATUSES,
} from '@modules/offerings/constants/offering-bid-status.constant';

/**
 * Guard the single-source-of-truth bid status tuples (TOV-156 + TOV-158). The cancel/refund path adds
 * `canceling`/`canceled`. The active set (the one-active-bid-per-collector slot) includes `canceling` (funds
 * still escrowed) but excludes the slot-freeing terminals `failed`/`canceled`. The DB-side drift-guards
 * (CHK_bid_status ↔ this tuple, and the partial-unique index predicate ↔ ACTIVE_BID_STATUSES) live in the
 * integration suite.
 */
describe('offering bid status constants', () => {
  it('OFFERING_BID_STATUSES is exactly the seven shipped states', () => {
    expect(OFFERING_BID_STATUSES).toEqual([
      'submitted',
      'escrowed',
      'failed',
      'canceling',
      'canceled',
      'won',
      'lost',
    ]);
  });

  it('ACTIVE_BID_STATUSES is {submitted,escrowed,canceling}; failed/canceled free the slot', () => {
    expect(ACTIVE_BID_STATUSES).toEqual(['submitted', 'escrowed', 'canceling']);
    expect(ACTIVE_BID_STATUSES).not.toContain('failed');
    expect(ACTIVE_BID_STATUSES).not.toContain('canceled');
    for (const s of ACTIVE_BID_STATUSES) {
      expect(OFFERING_BID_STATUSES).toContain(s);
    }
  });
});
