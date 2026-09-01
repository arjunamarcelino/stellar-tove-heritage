import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';
import { ParseStrKeyAddressPipe } from '../../../../../src/modules/backoffice/kyc-allowlist/pipes/parse-strkey-address.pipe';

const VALID = StrKey.encodeContract(Buffer.alloc(32, 7)); // a real C… contract StrKey (valid checksum)
const G_ACCOUNT = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O'; // valid BYOW account (TOV-243)
const M_MUXED = 'MB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJIAAAAAAAAAAAAHKSA';

describe('ParseStrKeyAddressPipe', () => {
  let pipe: ParseStrKeyAddressPipe;
  beforeEach(() => {
    pipe = new ParseStrKeyAddressPipe();
  });

  it('returns a valid C… contract StrKey unchanged', () => {
    expect(pipe.transform(VALID)).toBe(VALID);
  });

  it('returns a valid G… account StrKey unchanged (TOV-243)', () => {
    expect(pipe.transform(G_ACCOUNT)).toBe(G_ACCOUNT);
  });

  // The pipe only DELEGATES to `isValidStrKeyAddress` (exhaustively tested in the DTO predicate spec), so it
  // needs to prove only the delegation contract: pass-through, one representative reject, and the non-string
  // guard (which is pipe-specific — a raw @Param could be non-string and the SDK predicates throw on that).
  it('rejects a muxed M… address (one representative invalid → BadRequestException)', () => {
    expect(() => pipe.transform(M_MUXED)).toThrow(BadRequestException);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 123],
    ['array', [VALID]],
  ])('rejects a non-string input (%s) without throwing from the SDK predicates', (_label, value) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });
});
