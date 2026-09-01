import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Request to initiate (or resume) a wallet-rotation holdings transfer. The `from` (source) wallet is the
 * `:id` path param (owner-scoped from the JWT), never the body. `destinationWalletId` must be an owned BYOW
 * wallet that is the caller's current primary settlement wallet (validated + policy-checked in the service).
 */
export class RotateTransferDto {
  @ApiProperty({
    description: 'Destination wallet id — an owned BYOW wallet that is the current primary settlement wallet.',
    format: 'uuid',
  })
  @IsUUID()
  destinationWalletId!: string;
}
