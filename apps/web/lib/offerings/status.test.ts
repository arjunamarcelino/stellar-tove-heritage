import { describe, it, expect } from 'vitest';
import { offeringUiState, bidGateVerdict } from '@/lib/offerings/status';

const OPEN = '2026-08-20T12:00:00.000Z';
const CLOSE = '2026-08-27T12:00:00.000Z';
const openMs = Date.parse(OPEN);
const closeMs = Date.parse(CLOSE);
// Well inside [open, close) — the only instant that could ever be biddable.
const inWindow = openMs + 60_000;

describe('offeringUiState', () => {
  it('maps planned/approved to coming-soon', () => {
    expect(offeringUiState('planned', inWindow, OPEN, CLOSE)).toBe('coming-soon');
    expect(offeringUiState('approved', inWindow, OPEN, CLOSE)).toBe('coming-soon');
  });

  it('maps subscribed/settled to closed', () => {
    expect(offeringUiState('subscribed', inWindow, OPEN, CLOSE)).toBe('closed');
    expect(offeringUiState('settled', inWindow, OPEN, CLOSE)).toBe('closed');
  });

  it('maps canceled to canceled (window-independent)', () => {
    expect(offeringUiState('canceled', inWindow, OPEN, CLOSE)).toBe('canceled');
  });

  describe('opened — window-dependent', () => {
    it('is coming-soon before the open instant', () => {
      expect(offeringUiState('opened', openMs - 1, OPEN, CLOSE)).toBe('coming-soon');
    });

    it('is biddable at the open boundary (inclusive)', () => {
      expect(offeringUiState('opened', openMs, OPEN, CLOSE)).toBe('biddable');
    });

    it('is biddable inside the window', () => {
      expect(offeringUiState('opened', inWindow, OPEN, CLOSE)).toBe('biddable');
    });

    it('is closed at the close boundary (exclusive)', () => {
      expect(offeringUiState('opened', closeMs, OPEN, CLOSE)).toBe('closed');
    });

    it('is closed after the window', () => {
      expect(offeringUiState('opened', closeMs + 1, OPEN, CLOSE)).toBe('closed');
    });
  });
});

describe('bidGateVerdict', () => {
  const v = (
    over: Partial<{ hasActiveBid: boolean; isSignedIn: boolean; isWhitelisted: boolean }> = {},
  ) => ({
    hasActiveBid: false,
    isSignedIn: true,
    isWhitelisted: true,
    ...over,
  });

  it('an active bid wins over every other arm', () => {
    // Even for a non-biddable status / anonymous viewer, an active bid takes precedence.
    expect(bidGateVerdict('closed', v({ hasActiveBid: true, isSignedIn: false }))).toEqual({
      kind: 'active-bid',
    });
  });

  it('a non-biddable uiState → status', () => {
    for (const s of ['coming-soon', 'closed', 'canceled'] as const) {
      expect(bidGateVerdict(s, v())).toEqual({ kind: 'status' });
    }
  });

  it('biddable but anonymous → anon gate; signed-in but not whitelisted → not-whitelisted gate', () => {
    expect(bidGateVerdict('biddable', v({ isSignedIn: false }))).toEqual({
      kind: 'gate',
      reason: 'anon',
    });
    expect(bidGateVerdict('biddable', v({ isWhitelisted: false }))).toEqual({
      kind: 'gate',
      reason: 'not-whitelisted',
    });
  });

  it('biddable + signed-in + whitelisted → bid', () => {
    expect(bidGateVerdict('biddable', v())).toEqual({ kind: 'bid' });
  });
});
