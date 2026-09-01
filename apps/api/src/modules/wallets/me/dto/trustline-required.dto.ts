import { ApiProperty } from '@nestjs/swagger';
import { TrustlineInstruction } from '../../wallet-trustline.service.interface';

/** The classic USDC asset the wallet must trust. */
export class TrustlineAssetDto {
  @ApiProperty({ example: 'USDC' }) code!: string;
  @ApiProperty({ example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }) issuer!: string;
}

/**
 * Instruction to establish the USDC trustline on a freshly-bound BYOW wallet (TOV-32). Present on the
 * `POST /me/wallets` add response only when the wallet lacks the trustline. `changeTrustXdr` is an
 * UNSIGNED `sequence = 0` template — the wallet/FE fills the live sequence before signing & submitting
 * (see the FE contract). `asset` is provided so the FE can rebuild the tx itself if it prefers.
 */
export class TrustlineRequiredDto {
  @ApiProperty({ description: 'Unsigned change_trust tx (base64 XDR, seq=0 template) to sign & submit' })
  changeTrustXdr!: string;
  @ApiProperty({ type: TrustlineAssetDto }) asset!: TrustlineAssetDto;

  /** Map the port's neutral instruction to the response DTO (keeps port + Swagger types from drifting). */
  static fromInstruction(instruction: TrustlineInstruction): TrustlineRequiredDto {
    const dto = new TrustlineRequiredDto();
    dto.changeTrustXdr = instruction.changeTrustXdr;
    dto.asset = instruction.asset; // TrustlineAsset is structurally the DTO's asset shape
    return dto;
  }
}
