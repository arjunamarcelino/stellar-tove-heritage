import { ApiProperty } from '@nestjs/swagger';

/**
 * One FractionToken holding to sign + submit. The client drives `navigator.credentials.get` with
 * `challenge` (base64url of the OZ auth-digest), scoped to `credentialId`, then submits ONLY the assertion
 * for `itemId` — the unsigned tx stays server-side (verified against the stored copy at submit).
 */
export class RotateTransferItemDto {
  @ApiProperty() itemId!: string;
  @ApiProperty() tokenContract!: string;
  @ApiProperty({ description: 'Scaled i128 amount (frozen snapshot balance) as a decimal string' })
  amountScaled!: string;
  @ApiProperty({ description: 'WebAuthn challenge to sign (base64url, no padding)' })
  challenge!: string;
  @ApiProperty({ description: 'Ledger after which this item signature expires' })
  expiresAtLedger!: number;
}

/**
 * Result of initiating/resuming a rotation: the per-holding challenges to sign. Confirmed items from a
 * prior attempt are NOT included (never re-transferred) — only pending/failed holdings are returned.
 */
export class RotateTransferResponseDto {
  @ApiProperty() rotationId!: string;
  @ApiProperty() sourceWalletId!: string;
  @ApiProperty() destinationWalletId!: string;
  @ApiProperty({ description: 'Bound passkey credential id to scope navigator.credentials.get' })
  credentialId!: string;
  @ApiProperty({ nullable: true }) transports!: string | null;
  @ApiProperty() rpId!: string;
  @ApiProperty({ type: [RotateTransferItemDto] }) items!: RotateTransferItemDto[];

  static create(data: {
    rotationId: string;
    sourceWalletId: string;
    destinationWalletId: string;
    credentialId: string;
    transports: string | null;
    rpId: string;
    items: RotateTransferItemDto[];
  }): RotateTransferResponseDto {
    const dto = new RotateTransferResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
