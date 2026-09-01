import { describe, it, expect } from 'vitest';
import { rfqDetailGateVerdict } from '@/lib/accept/status';
import { rfqDetail } from '@/test/fixtures/accept';
import type { RfqDetailResult } from '@/lib/types/api';

const ok: RfqDetailResult = { status: 'success', rfq: rfqDetail };
const err = (code: RfqDetailResult extends { status: 'error' } ? never : string): RfqDetailResult =>
  ({ status: 'error', code, message: 'x' }) as RfqDetailResult;

describe('rfqDetailGateVerdict', () => {
  it('anonymous → gate regardless of result', () => {
    expect(rfqDetailGateVerdict({ isSignedIn: false, result: ok }).kind).toBe('gate');
  });

  it('success → panel', () => {
    expect(rfqDetailGateVerdict({ isSignedIn: true, result: ok }).kind).toBe('panel');
  });

  it('SESSION_EXPIRED → gate (stale token)', () => {
    expect(rfqDetailGateVerdict({ isSignedIn: true, result: err('SESSION_EXPIRED') }).kind).toBe(
      'gate',
    );
  });

  it('RFQ_NOT_FOUND → not-found (missing or not yours)', () => {
    expect(rfqDetailGateVerdict({ isSignedIn: true, result: err('RFQ_NOT_FOUND') }).kind).toBe(
      'not-found',
    );
  });

  it('transient errors → load-error', () => {
    expect(rfqDetailGateVerdict({ isSignedIn: true, result: err('NETWORK_ERROR') }).kind).toBe(
      'load-error',
    );
    expect(rfqDetailGateVerdict({ isSignedIn: true, result: err('SERVER_ERROR') }).kind).toBe(
      'load-error',
    );
  });
});
