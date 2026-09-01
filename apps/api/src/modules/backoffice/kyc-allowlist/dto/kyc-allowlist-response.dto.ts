import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  KYC_ALLOWLIST_ACTIONS,
  KYC_ALLOWLIST_RESULTS,
  KycAllowlistAction,
  KycAllowlistItemResult,
  KycAllowlistResultStatus,
} from '@modules/kyc-allowlist/kyc-allowlist.types';

/** Flattened wire shape of one item's outcome (the internal discriminated union → nullable wire fields). */
export class KycAllowlistItemResultDto {
  @ApiProperty() wallet!: string;
  @ApiProperty({ enum: KYC_ALLOWLIST_ACTIONS }) action!: KycAllowlistAction;
  @ApiProperty({ enum: KYC_ALLOWLIST_RESULTS }) status!: KycAllowlistResultStatus;
  @ApiPropertyOptional({ nullable: true, description: 'On-chain is_allowed after the op; null unless known (confirmed/noop)' })
  isAllowed!: boolean | null;
  @ApiPropertyOptional({ nullable: true, description: 'Submitted tx hash (confirmed/pending)' })
  txHash!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Sanitized failure reason (failed items)' })
  errorReason!: string | null;

  static fromResult(r: KycAllowlistItemResult): KycAllowlistItemResultDto {
    const dto = new KycAllowlistItemResultDto();
    dto.wallet = r.wallet;
    dto.action = r.action;
    dto.status = r.status;
    dto.isAllowed = r.status === 'confirmed' || r.status === 'noop' ? r.isAllowed : null;
    dto.txHash = r.status === 'confirmed' || r.status === 'pending' ? r.txHash : null;
    dto.errorReason = r.status === 'failed' ? r.errorReason : null;
    return dto;
  }
}

/** 200 body — the top-level status carries no aggregate meaning; the client reads each item's `status`. */
export class KycAllowlistResponseDto {
  @ApiProperty({ type: [KycAllowlistItemResultDto] })
  results!: KycAllowlistItemResultDto[];

  static fromResults(results: KycAllowlistItemResult[]): KycAllowlistResponseDto {
    const dto = new KycAllowlistResponseDto();
    dto.results = results.map((r) => KycAllowlistItemResultDto.fromResult(r));
    return dto;
  }
}
