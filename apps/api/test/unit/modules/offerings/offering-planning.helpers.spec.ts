import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { MAX_STROOPS } from '@common/constants/stroops.constant';
import {
  assertBandValid,
  resolveOfferableFloat,
} from '@modules/offerings/offering-planning.helpers';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';

/** Read the structured `{ errorCode }` body + HTTP status off a thrown HttpException. */
function httpOf(fn: () => unknown): { status: number; code: string } {
  try {
    fn();
  } catch (err) {
    const e = err as HttpException;
    const body = e.getResponse() as { errorCode?: string };
    return { status: e.getStatus(), code: body.errorCode ?? '' };
  }
  throw new Error('expected the function to throw');
}

/** Minimal deployed FractionContract with the retention amounts the float math needs. */
function fc(overrides: Partial<FractionContract> = {}): FractionContract {
  return {
    status: 'deployed',
    totalSupply: '1000000',
    artistRetentionAmount: '80000',
    treasuryRetentionAmount: '20000',
    ...overrides,
  } as FractionContract;
}

describe('assertBandValid', () => {
  it('accepts a valid band and returns the parsed bigints (positive)', () => {
    expect(assertBandValid('50000000', '150000000')).toEqual({
      low: 50000000n,
      high: 150000000n,
    });
  });

  it('accepts high === MAX_STROOPS (edge — the inclusive ceiling)', () => {
    expect(assertBandValid('1', MAX_STROOPS.toString())).toEqual({
      low: 1n,
      high: MAX_STROOPS,
    });
  });

  it.each([
    ['low = 0', '0', '100'],
    ['high = 0', '10', '0'],
    ['low === high', '100', '100'],
    ['low > high', '150', '50'],
    ['high > MAX_STROOPS', '1', (MAX_STROOPS + 1n).toString()],
  ])('rejects %s with 422 OFFERING_BAND_INVALID (negative)', (_label, low, high) => {
    expect(httpOf(() => assertBandValid(low, high))).toEqual({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ErrorCode.OFFERING_BAND_INVALID,
    });
  });
});

describe('resolveOfferableFloat', () => {
  it('returns contract + float + narrowed retention strings for a deployed contract (positive)', () => {
    const contract = fc();
    expect(resolveOfferableFloat(contract)).toEqual({
      contract,
      publicFloat: 900000n, // 1_000_000 − 80_000 − 20_000
      totalSupply: '1000000', // TOV-165 #348: snapshot source returned for symmetry
      artistRetentionAmount: '80000',
      treasuryRetentionAmount: '20000',
    });
  });

  it.each([
    ['null contract', null],
    ['status !== deployed', fc({ status: 'deploying' })],
    ['null artistRetentionAmount', fc({ artistRetentionAmount: null })],
    ['null treasuryRetentionAmount', fc({ treasuryRetentionAmount: null })],
  ])('rejects %s with 409 OFFERING_ARTWORK_NOT_FRACTIONALIZED (negative)', (_label, contract) => {
    expect(httpOf(() => resolveOfferableFloat(contract))).toEqual({
      status: HttpStatus.CONFLICT,
      code: ErrorCode.OFFERING_ARTWORK_NOT_FRACTIONALIZED,
    });
  });

  it.each([
    ['float === 0 (retentions consume the supply)', '100000', '100000', '0'],
    ['float < 0 (source corruption)', '100000', '60000', '50000'],
  ])('rejects %s with 422 OFFERING_NO_FLOAT (edge)', (_label, artist, treasury, total) => {
    const contract = fc({
      totalSupply: total,
      artistRetentionAmount: artist,
      treasuryRetentionAmount: treasury,
    });
    expect(httpOf(() => resolveOfferableFloat(contract))).toEqual({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ErrorCode.OFFERING_NO_FLOAT,
    });
  });
});
