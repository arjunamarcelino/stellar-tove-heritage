import { describe, it, expect } from 'vitest';

import {
  OFFERING_ERROR_CODES,
  classifyApproveError,
  formatCountdown,
  formatPublicFloat,
  isDeployInFlight,
  isLatched,
  offeringStatusLabel,
  offeringStatusVariant,
  remainingMs,
} from './offering-display';
import type { OfferingStatus } from './schemas';

const C_ADDR = 'C' + 'A'.repeat(55);
const ALL_STATUSES: OfferingStatus[] = [
  'planned',
  'approved',
  'opened',
  'subscribed',
  'settled',
  'canceled',
];

describe('status maps', () => {
  it('cover all 6 statuses with a variant and a label (no fallback)', () => {
    for (const s of ALL_STATUSES) {
      expect(offeringStatusVariant[s]).toBeDefined();
      expect(offeringStatusLabel[s]).toBeTruthy();
    }
  });
});

describe('classifyApproveError', () => {
  it('routes every known code and defaults unknown → error', () => {
    expect(classifyApproveError('OFFERING_APPROVAL_IN_PROGRESS')).toBe('neutral');
    expect(classifyApproveError('IDEMPOTENCY_KEY_IN_FLIGHT')).toBe('neutral');
    expect(classifyApproveError('OFFERING_NOT_PLANNED')).toBe('neutral');
    expect(classifyApproveError('OFFERING_APPROVAL_NOT_A_SIGNER')).toBe('not-a-signer');
    expect(classifyApproveError('IDEMPOTENCY_KEY_MISMATCH')).toBe('error');
    expect(classifyApproveError('OFFERING_NOT_FOUND')).toBe('error');
    expect(classifyApproveError('VALIDATION_FAILED')).toBe('error');
    expect(classifyApproveError('SOME_FUTURE_CODE')).toBe('error');
  });

  it('every code in the union is routed', () => {
    for (const code of OFFERING_ERROR_CODES) {
      expect(['neutral', 'not-a-signer', 'error']).toContain(classifyApproveError(code));
    }
  });
});

describe('deploy gate helpers', () => {
  const base = {
    status: 'planned' as OfferingStatus,
    escrow: { deployStatus: null as null | 'deploying' | 'deployed' | 'failed', contractAddress: null as string | null },
    approvals: { count: 0, threshold: 2 },
  };

  it('isDeployInFlight: true while deploying', () => {
    expect(isDeployInFlight({ ...base, escrow: { deployStatus: 'deploying', contractAddress: null } })).toBe(true);
  });

  it('isDeployInFlight: true for the quorum-reached transient (I5)', () => {
    expect(isDeployInFlight({ ...base, approvals: { count: 2, threshold: 2 } })).toBe(true);
  });

  it('isDeployInFlight: false when failed or below quorum', () => {
    expect(isDeployInFlight({ ...base, approvals: { count: 2, threshold: 2 }, escrow: { deployStatus: 'failed', contractAddress: null } })).toBe(false);
    expect(isDeployInFlight(base)).toBe(false);
  });

  it('isLatched: requires deployed + approved + VALID address', () => {
    expect(isLatched({ status: 'approved', escrow: { deployStatus: 'deployed', contractAddress: C_ADDR }, approvals: { count: 2, threshold: 2 } })).toBe(true);
    expect(isLatched({ status: 'approved', escrow: { deployStatus: 'deployed', contractAddress: null }, approvals: { count: 2, threshold: 2 } })).toBe(false);
    expect(isLatched({ status: 'approved', escrow: { deployStatus: 'deployed', contractAddress: 'not-a-strkey' }, approvals: { count: 2, threshold: 2 } })).toBe(false);
    expect(isLatched({ status: 'planned', escrow: { deployStatus: 'deployed', contractAddress: C_ADDR }, approvals: { count: 2, threshold: 2 } })).toBe(false);
  });

});

describe('money + countdown', () => {
  it('formatPublicFloat groups the integer', () => {
    expect(formatPublicFloat('800000')).toBe('800,000');
  });

  it('remainingMs: positive for future, 0 for past', () => {
    const now = Date.parse('2026-09-01T00:00:00.000Z');
    expect(remainingMs('2026-09-01T00:01:00.000Z', now)).toBe(60_000);
    expect(remainingMs('2026-08-31T23:59:00.000Z', now)).toBe(0);
  });

  it('formatCountdown: days/hours/minutes/seconds and "Window open"', () => {
    expect(formatCountdown(0)).toBe('Window open');
    expect(formatCountdown(-5)).toBe('Window open');
    expect(formatCountdown(90_000)).toBe('1m 30s');
    expect(formatCountdown(3_600_000 + 120_000)).toBe('1h 2m');
    expect(formatCountdown(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 3h 0m');
  });
});
