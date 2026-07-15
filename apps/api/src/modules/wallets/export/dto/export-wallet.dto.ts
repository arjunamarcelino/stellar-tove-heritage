import { ApiProperty } from '@nestjs/swagger';
import { IsStellarAddress } from '@common/validators/is-stellar-address.validator';

/**
 * Request to initiate (or resume) an embedded-wallet export. The `from` wallet is the `:id` path param
 * (owner-scoped from the JWT), never the body. `targetAddress` must be a KYC-allowlisted self-custody
 * G-address (validated + policy-checked in the service).
 */
export class ExportWalletDto {
  @ApiProperty({
    description: 'Self-custody destination Stellar address (G...). Must be on the KYC allowlist.',
    example: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  })
  @IsStellarAddress()
  targetAddress!: string;
}
