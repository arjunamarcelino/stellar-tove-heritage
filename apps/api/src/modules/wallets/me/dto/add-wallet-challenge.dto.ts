import { ApiProperty } from '@nestjs/swagger';
import { IsStellarPublicKey } from '@common/validators/is-stellar-public-key.validator';

/**
 * Body for `POST /me/wallets/challenge` (TOV-24): the new BYOW public key to bind. The issued challenge
 * is stamped with the authenticated Collector's id so a leaked signed XDR can't be redirected to another
 * account. BYOW only — a Stellar ed25519 G-address (embedded wallets are created at passkey registration).
 */
export class AddWalletChallengeDto {
  @ApiProperty({
    description: 'Stellar public key (StrKey, ed25519) of the wallet to bind',
    example: 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
  })
  @IsStellarPublicKey()
  publicKey!: string;
}
