import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';
import { KYC_ALLOWLIST_ACTIONS, KycAllowlistAction } from '@modules/kyc-allowlist/kyc-allowlist.types';

/** Shared human message for a StrKey-address validation failure — reused by the pipe (TOV-241) so it can't drift. */
export const STRKEY_ADDRESS_MESSAGE =
  'wallet must be a valid Stellar account (G…) or Soroban contract (C…) StrKey, checksum';

/**
 * The one Stellar-address validation predicate (CRC16 checksum, not just base32 shape). Accepts BOTH a
 * BYOW classic **account** StrKey (`G…`, TOV-243) and a Collector smart-wallet **contract** StrKey (`C…`).
 * Single source of truth shared by the body validator (`IsStrKeyAddress`) and the path-param pipe
 * (`ParseStrKeyAddressPipe`, TOV-241 todo 270), so path-param and body validation of the same wallet
 * concept can never drift. The `typeof` guard keeps the SDK predicates from throwing on a non-string input;
 * the disjunction is parenthesised so the guard covers BOTH terms (not `(typeof && A) || B`).
 */
export function isValidStrKeyAddress(value: unknown): value is string {
  return typeof value === 'string' && (StrKey.isValidContract(value) || StrKey.isValidEd25519PublicKey(value));
}

/**
 * Full StrKey validation (CRC16 checksum, not just the base32 shape). A shape-valid but checksum-invalid
 * address is a typo that would otherwise whitelist a different/invalid wallet — reject it at the boundary.
 * Rejects muxed (`M…`), claimable-balance (`B…`), and liquidity-pool (`L…`) StrKeys (neither predicate matches).
 */
@ValidatorConstraint({ name: 'isStrKeyAddress', async: false })
export class IsStrKeyAddress implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidStrKeyAddress(value);
  }
  defaultMessage(): string {
    return STRKEY_ADDRESS_MESSAGE;
  }
}

export class KycAllowlistItemDto {
  // Full StrKey checksum validation (IsStrKeyAddress) subsumes a base32 shape/length regex, so no separate
  // @Matches/@IsString is needed (todo 234). The DB CHECK + walletToScVal re-validate at their boundaries.
  @ApiProperty({
    example: 'GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJJRMA',
    description:
      'Collector wallet StrKey (56 chars): a BYOW classic account (G…, TOV-243) or a smart-wallet contract (C…)',
  })
  @Validate(IsStrKeyAddress)
  wallet!: string;

  @ApiProperty({ enum: KYC_ALLOWLIST_ACTIONS })
  @IsIn([...KYC_ALLOWLIST_ACTIONS])
  action!: KycAllowlistAction;

  @ApiPropertyOptional({ example: 'kyc_passed', description: 'Machine-readable snake_case reason code' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{1,64}$/, { message: 'reason must be a snake_case code, 1-64 chars' })
  reason?: string;
}
