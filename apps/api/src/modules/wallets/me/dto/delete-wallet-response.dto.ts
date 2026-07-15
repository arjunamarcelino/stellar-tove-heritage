import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of `DELETE /me/wallets/:id` (TOV-25 #160). When the deleted wallet was the primary settlement
 * wallet, the backend auto-promotes the oldest eligible sibling and reports it here so the caller learns the
 * new settlement wallet without a follow-up `GET /me/wallets`. `newPrimaryWalletId` is null when no promotion
 * happened (a non-primary wallet was removed).
 */
export class DeleteWalletResponseDto {
  @ApiProperty({ description: 'Id of the wallet that was soft-unbound' })
  deletedId!: string;

  @ApiProperty({
    nullable: true,
    description: 'The wallet auto-promoted to primary (settlement), or null if the primary was unchanged',
  })
  newPrimaryWalletId!: string | null;
}
