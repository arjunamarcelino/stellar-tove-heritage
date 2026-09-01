import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of preparing a bid (TOV-156). The client drives `navigator.credentials.get` with `challenge`
 * (base64url of the OZ auth-digest over the nested submit_bid tree), scoped to `credentialId`/`transports`,
 * then submits the assertion. `escrowAmountStroops` (= price × count) is what will be escrowed — show the
 * total. No bid row is created until submit.
 */
export class PrepareBidResponseDto {
  @ApiProperty({ description: 'Unsigned submit_bid transaction (base64 XDR) to sign + submit' })
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

  @ApiProperty({ description: 'Total USDC stroops that will be escrowed (price × count)', type: String })
  escrowAmountStroops!: string;

  @ApiProperty({ description: 'Bid price per fraction in stroops (echo)', type: String })
  price!: string;

  @ApiProperty({ description: 'Fraction count (echo)' })
  count!: number;

  static create(data: {
    txXdr: string;
    challenge: string;
    expiresAtLedger: number;
    credentialId: string;
    transports: string | null;
    rpId: string;
    escrowContract: string;
    escrowAmountStroops: string;
    price: string;
    count: number;
  }): PrepareBidResponseDto {
    const dto = new PrepareBidResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
