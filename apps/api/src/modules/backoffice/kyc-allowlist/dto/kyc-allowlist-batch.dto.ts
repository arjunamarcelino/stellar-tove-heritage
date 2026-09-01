import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { KycAllowlistItemDto } from './kyc-allowlist-item.dto';

/** No duplicate (wallet, action) within one batch — keeps the idempotency fingerprint a total order and
 * avoids ambiguous double-submits for the same wallet. */
@ValidatorConstraint({ name: 'uniqueBatchItems', async: false })
export class UniqueBatchItems implements ValidatorConstraintInterface {
  validate(_value: unknown, args?: ValidationArguments): boolean {
    const items = (args?.object as KycAllowlistBatchDto | undefined)?.items ?? [];
    const keys = items.map((i) => `${i.wallet}:${i.action}`);
    return new Set(keys).size === keys.length;
  }
  defaultMessage(): string {
    return 'items must not contain duplicate (wallet, action) pairs';
  }
}

/** Hard DoS backstop on the array size. The configured operational cap (KYC_ALLOWLIST_MAX_BATCH, ≤10) is
 * enforced in the service with a 422; this decorator is the compile-time ceiling. */
const HARD_CEILING = 10;

export class KycAllowlistBatchDto {
  @ApiProperty({ type: [KycAllowlistItemDto], description: '1-10 add/remove items, processed serially' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(HARD_CEILING)
  @ValidateNested({ each: true })
  @Type(() => KycAllowlistItemDto)
  @Validate(UniqueBatchItems)
  items!: KycAllowlistItemDto[];
}
