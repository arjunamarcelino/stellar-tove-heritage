import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of preparing a bid cancel (TOV-158). The client drives `navigator.credentials.get` with `challenge`
 * (base64url of the OZ auth-digest over the root-only cancel_bid tree), scoped to `credentialId`/`transports`,
 * then submits the assertion to `POST :id/bids/cancel`. No row is mutated until submit. `bidId` echoes the
 * on-chain bid id being canceled (informational).
 */
export class PrepareCancelBidResponseDto {
  @ApiProperty({ description: 'Unsigned cancel_bid transaction (base64 XDR) to sign + submit' })
  txXdr!: string;

  @ApiProperty({ description: 'WebAuthn challenge to sign (base64url, no padding)' })
  challenge!: string;

  @ApiProperty({ description: 'Ledger sequence after which the signature expires' })
  expiresAtLedger!: number;

  @ApiProperty({ description: 'Bound passkey credential id to scope navigator.credentials.get' })
  credentialId!: string;

  @ApiProperty({ description: 'Bound passkey transports (comma-joined), or null', nullable: true })
  transports!: string | null;

  @ApiProperty({ description: 'Relying-party id for the assertion' })
  rpId!: string;

  @ApiProperty({ description: "The offering's escrow contract address (C...)" })
  escrowContract!: string;

  @ApiProperty({ description: 'The on-chain bid id (u32) being canceled' })
  bidId!: number;

  static create(data: {
    txXdr: string;
    challenge: string;
    expiresAtLedger: number;
    credentialId: string;
    transports: string | null;
    rpId: string;
    escrowContract: string;
    bidId: number;
  }): PrepareCancelBidResponseDto {
    const dto = new PrepareCancelBidResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
