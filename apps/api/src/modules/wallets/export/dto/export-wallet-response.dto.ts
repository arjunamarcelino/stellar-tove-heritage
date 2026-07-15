import { ApiProperty } from '@nestjs/swagger';
import { EXPORT_TOKEN_KINDS, ExportTokenKind } from '../export-status.types';

/**
 * One holding to sign + submit. The client drives `navigator.credentials.get` with `challenge`
 * (base64url of the OZ auth-digest), scoped to `credentialId`, then submits ONLY the assertion for
 * `itemId` — the unsigned tx stays server-side (verified against the stored copy at submit).
 */
export class ExportItemDto {
  @ApiProperty() itemId!: string;
  @ApiProperty() tokenContract!: string;
  @ApiProperty({ enum: [...EXPORT_TOKEN_KINDS] }) tokenKind!: ExportTokenKind;
  @ApiProperty({ description: 'Scaled i128 amount (frozen snapshot balance) as a decimal string' })
  amountScaled!: string;
  @ApiProperty({ description: 'Token decimals — divide amountScaled by 10^decimals for the human amount' })
  decimals!: number;
  @ApiProperty({ description: 'Asset code / symbol (on-chain `symbol()`; "USDC" for USDC)' })
  assetCode!: string;
  @ApiProperty({ description: 'Human label for the confirm screen (asset code; artwork title pending M04)' })
  displayName!: string;
  @ApiProperty({ description: 'WebAuthn challenge to sign (base64url, no padding)' })
  challenge!: string;
  @ApiProperty({ description: 'Ledger after which this item signature expires' })
  expiresAtLedger!: number;
}

/**
 * Result of initiating/resuming an export: the per-holding challenges to sign. Confirmed items from a
 * prior attempt are NOT included (never re-transferred). Only pending/failed holdings are returned.
 */
export class ExportWalletResponseDto {
  @ApiProperty() exportId!: string;
  @ApiProperty() targetAddress!: string;
  @ApiProperty({ description: 'Bound passkey credential id to scope navigator.credentials.get' })
  credentialId!: string;
  @ApiProperty({ nullable: true }) transports!: string | null;
  @ApiProperty() rpId!: string;
  @ApiProperty({ type: [ExportItemDto] }) items!: ExportItemDto[];

  static create(data: {
    exportId: string;
    targetAddress: string;
    credentialId: string;
    transports: string | null;
    rpId: string;
    items: ExportItemDto[];
  }): ExportWalletResponseDto {
    const dto = new ExportWalletResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
