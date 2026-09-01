import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Wallet, WalletKind } from '../../entities/wallet.entity';
import { TrustlineRequiredDto } from './trustline-required.dto';

/**
 * A wallet in the caller's `GET /me/wallets` list. Shared by the export UI (TOV-40) and the multi-wallet
 * settings surface (TOV-24). `address` is the embedded contract (C…) or the byow public key (G…); the
 * explicit `publicKey`/`contractAddress` fields are additive for TOV-24 (FR-01.03 asks for `public_key`
 * + `is_primary` + `created_at`). `hasHoldings` is intentionally omitted for MVP — the FE gates on the
 * export/status response instead.
 */
export class MeWalletDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['byow', 'embedded_passkey'] }) kind!: WalletKind;
  @ApiProperty({ description: 'Contract address (embedded) or public key (byow)' })
  address!: string;
  @ApiProperty({ nullable: true, description: 'Stellar public key (G…) for byow wallets; null for embedded' })
  publicKey!: string | null;
  @ApiProperty({ nullable: true, description: 'Soroban contract address (C…) for embedded wallets; null for byow' })
  contractAddress!: string | null;
  @ApiProperty({ description: 'Whether this is the Collector\'s primary wallet (delete-protected)' })
  isPrimary!: boolean;
  @ApiProperty({ description: 'Whether this embedded wallet has been exported (one-way latch)' })
  exported!: boolean;
  @ApiProperty({ description: 'When the wallet was bound to the Collector' })
  createdAt!: Date;

  @ApiPropertyOptional({
    type: TrustlineRequiredDto,
    description:
      'Present (byow add response only) when the wallet lacks the USDC trustline: a change_trust XDR to sign & submit (TOV-32).',
  })
  trustlineRequired?: TrustlineRequiredDto;

  static fromEntity(w: Wallet): MeWalletDto {
    const dto = new MeWalletDto();
    dto.id = w.id;
    dto.kind = w.kind;
    dto.address = w.contractAddress ?? w.publicKey ?? '';
    dto.publicKey = w.publicKey;
    dto.contractAddress = w.contractAddress;
    dto.isPrimary = w.isPrimary;
    dto.exported = w.status === 'exported';
    dto.createdAt = w.createdAt;
    return dto;
  }
}
