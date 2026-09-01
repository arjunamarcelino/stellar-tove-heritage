import { describe, it, expect } from 'vitest';
import { deriveSettlementOutcome, countConfirmed } from '@/lib/wallet/settlementOutcome';
import type { RotationItemStatus } from '@/lib/types/api';

const items = (...statuses: RotationItemStatus[]) => statuses.map((status) => ({ status }));

describe('deriveSettlementOutcome', () => {
  it('returns inflight for an empty set (nothing to conclude)', () => {
    expect(deriveSettlementOutcome([])).toBe('inflight');
  });

  it('returns inflight while any item is pending or submitted', () => {
    expect(deriveSettlementOutcome(items('confirmed', 'submitted'))).toBe('inflight');
    expect(deriveSettlementOutcome(items('failed', 'pending'))).toBe('inflight');
  });

  it('returns complete only when every item is confirmed', () => {
    expect(deriveSettlementOutcome(items('confirmed', 'confirmed'))).toBe('complete');
  });

  it('returns partial when some confirmed and the rest terminally failed', () => {
    expect(deriveSettlementOutcome(items('confirmed', 'failed'))).toBe('partial');
  });

  it('returns failed only when zero confirmed and all terminal', () => {
    expect(deriveSettlementOutcome(items('failed', 'failed'))).toBe('failed');
  });

  it('never reports failed/partial while an item is still in flight (money-safety)', () => {
    // A confirmed + a still-broadcasting item must not be called partial yet.
    expect(deriveSettlementOutcome(items('confirmed', 'submitted'))).not.toBe('partial');
  });
});

describe('countConfirmed', () => {
  it('counts confirmed items monotonically', () => {
    expect(countConfirmed(items('confirmed', 'failed', 'confirmed', 'pending'))).toBe(2);
    expect(countConfirmed([])).toBe(0);
  });
});
