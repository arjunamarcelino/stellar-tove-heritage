import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycAllowlistState } from '@modules/kyc-allowlist/entities/kyc-allowlist-state.entity';
import { KYC_ALLOWLIST_ACTIONS, KycAllowlistAction } from '@modules/kyc-allowlist/kyc-allowlist.types';

/**
 * 200 body for `GET kyc/allowlist/:wallet` (TOV-241). Advisory read of the `kyc_allowlist_state` mirror.
 * The guaranteed core is `{ wallet, isAllowed }`; provenance is additive and null for a never-seen wallet.
 * A never-seen wallet is `200 { isAllowed:false }` (NOT 404) so the UI can tell "not on the list" apart from
 * "endpoint unavailable". Provenance fields (`lastAction`, `lastTxHash`, `lastLedger`, `updatedAt`) are all
 * `null` for a never-seen wallet. `lastAction` and `updatedAt` are non-nullable on a real row, so either
 * being `null` reliably signals never-seen; `lastTxHash`/`lastLedger` can legitimately be null on a present row.
 *
 * The response shape is fixed (all keys always present, `null` when N/A). `@ApiPropertyOptional` is used for
 * the nullable fields to match the same-module `KycAllowlistResponseDto`; strictly, `@ApiProperty({ nullable:
 * true })` (required + nullable) would be more precise — kept for module consistency (todo 271).
 */
export class KycAllowlistStatusResponseDto {
  @ApiProperty({ example: 'GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJJRMA', description: 'The queried wallet StrKey — account (G…) or contract (C…) — echoed verbatim' })
  wallet!: string;

  @ApiProperty({
    example: true,
    description:
      'ADVISORY mirror of on-chain is_allowed — display only, NOT an authorization signal. It is refreshed only ' +
      'by this system’s confirmed mutations, so it can lag or miss out-of-band on-chain changes (another admin ' +
      'key / multisig / direct contract call). Never-seen wallet → false. If a trustworthy value is needed, read ' +
      'is_allowed on-chain instead.',
  })
  isAllowed!: boolean;

  @ApiPropertyOptional({ enum: KYC_ALLOWLIST_ACTIONS, nullable: true, description: 'Last applied action; null if never seen' })
  lastAction!: KycAllowlistAction | null;

  @ApiPropertyOptional({ nullable: true, description: 'Tx hash of the last applied mutation' })
  lastTxHash!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Ledger sequence of the last applied mutation (bigint → string)' })
  lastLedger!: string | null;

  @ApiPropertyOptional({ example: '2026-08-18T10:00:00.000Z', nullable: true, description: 'ISO timestamp of the last mirror write; null if never seen' })
  updatedAt!: string | null;

  /** null state = never seen → isAllowed:false, provenance null (200, NOT 404). Plain construction, never Object.assign. */
  static fromState(wallet: string, state: KycAllowlistState | null): KycAllowlistStatusResponseDto {
    const dto = new KycAllowlistStatusResponseDto();
    dto.wallet = wallet;
    dto.isAllowed = state?.isAllowed ?? false;
    dto.lastAction = state?.lastAction ?? null;
    dto.lastTxHash = state?.lastTxHash ?? null;
    dto.lastLedger = state?.lastLedger ?? null;
    dto.updatedAt = state ? state.updatedAt.toISOString() : null;
    return dto;
  }
}
