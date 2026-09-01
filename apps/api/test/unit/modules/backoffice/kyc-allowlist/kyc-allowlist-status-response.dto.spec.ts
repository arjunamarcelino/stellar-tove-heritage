import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { KycAllowlistStatusResponseDto } from '../../../../../src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-status-response.dto';
import { KycAllowlistState } from '../../../../../src/modules/kyc-allowlist/entities/kyc-allowlist-state.entity';

const WALLET = StrKey.encodeContract(Buffer.alloc(32, 1));

function row(overrides: Partial<KycAllowlistState>): KycAllowlistState {
  const s = new KycAllowlistState();
  s.wallet = WALLET;
  s.isAllowed = true;
  s.lastAction = 'add';
  s.lastTxHash = 'a'.repeat(64);
  s.lastLedger = '512345';
  s.createdAt = new Date('2026-08-18T00:00:00.000Z');
  s.updatedAt = new Date('2026-08-18T10:00:00.000Z');
  return Object.assign(s, overrides);
}

describe('KycAllowlistStatusResponseDto.fromState', () => {
  it('null state (never seen) → isAllowed:false with all provenance null', () => {
    const dto = KycAllowlistStatusResponseDto.fromState(WALLET, null);
    expect(dto).toEqual({
      wallet: WALLET,
      isAllowed: false,
      lastAction: null,
      lastTxHash: null,
      lastLedger: null,
      updatedAt: null,
    });
  });

  it('is_allowed=true row → maps every field; updatedAt is an ISO string', () => {
    const dto = KycAllowlistStatusResponseDto.fromState(WALLET, row({}));
    expect(dto).toEqual({
      wallet: WALLET,
      isAllowed: true,
      lastAction: 'add',
      lastTxHash: 'a'.repeat(64),
      lastLedger: '512345',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });
  });

  it('removed row (is_allowed=false, last_action=remove) → isAllowed:false with non-null provenance (distinct from never-seen)', () => {
    const dto = KycAllowlistStatusResponseDto.fromState(WALLET, row({ isAllowed: false, lastAction: 'remove' }));
    expect(dto.isAllowed).toBe(false);
    expect(dto.lastAction).toBe('remove'); // non-null lastAction is the reliable never-seen discriminator
  });

  it('a present is_allowed=false row is distinguished from never-seen by non-null provenance (not by isAllowed)', () => {
    // NB: for isAllowed itself, `false ?? false` === `false || false`, so isAllowed alone can't tell a present
    // false row from never-seen. The discriminator is the provenance (updatedAt/lastAction), which is non-null
    // only on a real row — that IS where `?? not ||` matters (a `|| null` would blank a present falsy field).
    const dto = KycAllowlistStatusResponseDto.fromState(WALLET, row({ isAllowed: false }));
    expect(dto.isAllowed).toBe(false);
    expect(dto.updatedAt).not.toBeNull();
    expect(dto.lastAction).not.toBeNull();
  });

  it('preserves lastLedger as a string (no numeric coercion / precision loss)', () => {
    const big = '9223372036854775807'; // > Number.MAX_SAFE_INTEGER
    const dto = KycAllowlistStatusResponseDto.fromState(WALLET, row({ lastLedger: big }));
    expect(dto.lastLedger).toBe(big);
  });

  it('allows a present row with null tx hash / ledger (legitimately null provenance)', () => {
    const dto = KycAllowlistStatusResponseDto.fromState(WALLET, row({ lastTxHash: null, lastLedger: null }));
    expect(dto.lastTxHash).toBeNull();
    expect(dto.lastLedger).toBeNull();
    expect(dto.lastAction).toBe('add'); // still a real row
  });
});
