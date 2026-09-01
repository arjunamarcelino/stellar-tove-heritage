import { describe, it, expect } from 'vitest';
import {
  deriveSettlementPhase,
  SettlementPhase,
} from '../../../../../src/modules/backoffice/offerings/settlement-phase';
import { Offering } from '../../../../../src/modules/offerings/entities/offering.entity';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const PAST = new Date('2026-08-20T12:00:00.000Z'); // window closed
const FUTURE = new Date('2026-08-22T12:00:00.000Z'); // window still open

function off(status: string, windowCloseAt: Date, settleFailedAt: Date | null = null): Offering {
  return { status, windowCloseAt, settleFailedAt } as unknown as Offering;
}

describe('deriveSettlementPhase — FR-05.06 vocabulary (TOV-165)', () => {
  it('P1 canceled → canceled (regardless of window)', () => {
    expect(deriveSettlementPhase(off('canceled', PAST), NOW)).toBe('canceled');
    expect(deriveSettlementPhase(off('canceled', FUTURE), NOW)).toBe('canceled');
  });

  it('P2 settled → settled', () => {
    expect(deriveSettlementPhase(off('settled', PAST), NOW)).toBe('settled');
  });

  it('P3 subscribed → settling (window ignored)', () => {
    expect(deriveSettlementPhase(off('subscribed', PAST), NOW)).toBe('settling');
    // "impossible" cell: subscribed + window still open must NOT be undefined — window is ignored here.
    expect(deriveSettlementPhase(off('subscribed', FUTURE), NOW)).toBe('settling');
  });

  it('P4 subscribed + settle_failed_at → still settling (failure rides on its own DTO field)', () => {
    expect(deriveSettlementPhase(off('subscribed', PAST, new Date()), NOW)).toBe('settling');
  });

  it('P5 opened + window closed → closed', () => {
    expect(deriveSettlementPhase(off('opened', PAST), NOW)).toBe('closed');
  });

  it('P6 opened + window open → null', () => {
    expect(deriveSettlementPhase(off('opened', FUTURE), NOW)).toBeNull();
  });

  it('P7 planned / approved → null', () => {
    expect(deriveSettlementPhase(off('planned', PAST), NOW)).toBeNull();
    expect(deriveSettlementPhase(off('approved', PAST), NOW)).toBeNull();
  });

  it('P8 "impossible" cell: settled + settle_failed_at set → still settled (status short-circuits)', () => {
    expect(deriveSettlementPhase(off('settled', PAST, new Date()), NOW)).toBe('settled');
  });

  it('P9 boundary: now == windowCloseAt → closed (>= is inclusive)', () => {
    expect(deriveSettlementPhase(off('opened', NOW), NOW)).toBe('closed');
  });

  it('P10 determinism: same offering, two clocks straddling window_close_at → null vs closed', () => {
    const o = off('opened', NOW);
    const before: SettlementPhase = deriveSettlementPhase(o, new Date(NOW.getTime() - 1));
    const after: SettlementPhase = deriveSettlementPhase(o, new Date(NOW.getTime() + 1));
    expect(before).toBeNull();
    expect(after).toBe('closed');
  });
});
