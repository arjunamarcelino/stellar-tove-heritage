import { describe, it, expect } from 'vitest';
import {
  addBusinessDays,
  estimatedDecisionDate,
  formatWhitelistDate,
  isPastDue,
} from '@/lib/kyc/whitelistSla';

describe('addBusinessDays', () => {
  it('skips the weekend: Friday + 2 business days lands on Tuesday', () => {
    // 2026-07-17 is a Friday. +2 business days skips Sat/Sun → Mon(1), Tue(2) = 2026-07-21.
    const result = addBusinessDays('2026-07-17T00:00:00Z', 2);
    expect(formatWhitelistDate(result)).toBe('21 Jul 2026');
  });

  it('stays within the week when no weekend is crossed', () => {
    // 2026-07-14 is a Tuesday → Wed(1), Thu(2) = 2026-07-16.
    const result = addBusinessDays('2026-07-14T00:00:00Z', 2);
    expect(formatWhitelistDate(result)).toBe('16 Jul 2026');
  });

  it('does not mutate via the shared input and computes in UTC', () => {
    const iso = '2026-07-17T23:30:00Z';
    const result = addBusinessDays(iso, 2);
    // UTC arithmetic keeps the same wall-clock time-of-day component.
    expect(result?.toISOString()).toBe('2026-07-21T23:30:00.000Z');
  });

  it('returns null for missing or unparseable input', () => {
    expect(addBusinessDays(null, 2)).toBeNull();
    expect(addBusinessDays(undefined, 2)).toBeNull();
    expect(addBusinessDays('not-a-date', 2)).toBeNull();
  });
});

describe('estimatedDecisionDate', () => {
  it('applies the 2-business-day SLA window', () => {
    expect(formatWhitelistDate(estimatedDecisionDate('2026-07-17T00:00:00Z'))).toBe('21 Jul 2026');
  });

  it('returns null when last_submission_at is missing/invalid', () => {
    expect(estimatedDecisionDate(null)).toBeNull();
    expect(estimatedDecisionDate('bogus')).toBeNull();
  });
});

describe('formatWhitelistDate', () => {
  it('formats a fixed en-GB/UTC date and is string↔Date consistent', () => {
    const iso = '2026-07-17T12:00:00Z';
    expect(formatWhitelistDate(iso)).toBe('17 Jul 2026');
    expect(formatWhitelistDate(new Date(iso))).toBe('17 Jul 2026');
  });

  it('returns null for missing/invalid values', () => {
    expect(formatWhitelistDate(null)).toBeNull();
    expect(formatWhitelistDate(undefined)).toBeNull();
    expect(formatWhitelistDate('nope')).toBeNull();
  });
});

describe('isPastDue', () => {
  const date = new Date('2026-07-21T00:00:00Z');

  it('is true when the estimate is before now', () => {
    expect(isPastDue(date, Date.parse('2026-07-22T00:00:00Z'))).toBe(true);
  });

  it('is false when the estimate is in the future or null', () => {
    expect(isPastDue(date, Date.parse('2026-07-20T00:00:00Z'))).toBe(false);
    expect(isPastDue(null, Date.parse('2026-07-22T00:00:00Z'))).toBe(false);
  });
});
