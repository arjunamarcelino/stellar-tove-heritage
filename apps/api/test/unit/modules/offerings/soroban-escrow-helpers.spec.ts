import { describe, it, expect } from 'vitest';
import { parseContractErrorCode } from '../../../../src/modules/offerings/escrow/soroban-offering-escrow.service';

/**
 * parseContractErrorCode drives control flow (TOV-160 #317 classifies OfferingNotOpen=1 as retryable), so the
 * parse must be exact — only the canonical `Error(Contract, #n)` shape, never a stray `#n` elsewhere (#336).
 */
describe('parseContractErrorCode', () => {
  it('extracts the code from the canonical contract-error string', () => {
    expect(parseContractErrorCode('HostError: Error(Contract, #1)')).toBe(1);
    expect(parseContractErrorCode('...Error(Contract, #8) invalid allocation')).toBe(8);
    expect(parseContractErrorCode('Error(Contract,#13)')).toBe(13);
  });

  it('returns null for a non-contract revert / resource error (no loose #n match)', () => {
    expect(parseContractErrorCode('resource limit exceeded: ledger entry #5 of 100')).toBeNull();
    expect(parseContractErrorCode('TxTooLarge')).toBeNull();
    expect(parseContractErrorCode('unexpected budget #7 overrun')).toBeNull();
  });
});
