import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { STRKEY_ADDRESS_MESSAGE, isValidStrKeyAddress } from '../dto/kyc-allowlist-item.dto';

/**
 * Validates a `:wallet` path param as a Stellar account (`G…`, TOV-243) or Soroban contract (`C…`) StrKey
 * (full CRC16 checksum) — the same rule as `IsStrKeyAddress` on the POST DTO, so both share
 * `isValidStrKeyAddress` + `STRKEY_ADDRESS_MESSAGE` (single source of truth). On failure it throws
 * `BadRequestException` → `AllExceptionsFilter` maps the 400 to `errorCode: VALIDATION_FAILED`, matching the
 * POST's malformed-address behavior (TOV-241).
 *
 * Input generic is `unknown` (not `string`): `@Param` values are strings at runtime, but `isValidStrKeyAddress`
 * keeps a load-bearing `typeof` guard so the SDK predicates never receive a non-string (they throw).
 */
@Injectable()
export class ParseStrKeyAddressPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isValidStrKeyAddress(value)) {
      throw new BadRequestException(STRKEY_ADDRESS_MESSAGE);
    }
    return value; // narrowed to string by the isValidStrKeyAddress type predicate
  }
}
