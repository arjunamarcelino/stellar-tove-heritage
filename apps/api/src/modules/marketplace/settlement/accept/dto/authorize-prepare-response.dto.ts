import { ApiProperty } from '@nestjs/swagger';

class AuthorizeTradeDto {
  @ApiProperty() count!: string;
  @ApiProperty() grossStroops!: string;
  @ApiProperty() pricePerFractionStroops!: string;
}

/** authorize/prepare response: the WebAuthn challenge the seller signs + the unsigned entry to round-trip. */
export class AuthorizePrepareResponseDto {
  @ApiProperty({ description: 'WebAuthn challenge (base64url) the seller passkey signs.' })
  challenge!: string;

  @ApiProperty({ description: 'Ledger the seller signature is valid until (= the quote validity window).' })
  expiresAtLedger!: number;

  @ApiProperty() credentialId!: string;
  @ApiProperty({ nullable: true }) transports!: string | null;
  @ApiProperty() rpId!: string;

  @ApiProperty({ description: 'The unsigned seller auth entry (base64 XDR) to round-trip back to /authorize.' })
  sellerAuthEntryXdr!: string;

  @ApiProperty({ type: AuthorizeTradeDto })
  trade!: AuthorizeTradeDto;

  static build(input: {
    challenge: string;
    expiresAtLedger: number;
    credentialId: string;
    transports: string | null;
    rpId: string;
    sellerAuthEntryXdr: string;
    count: string;
    grossStroops: string;
    pricePerFractionStroops: string;
  }): AuthorizePrepareResponseDto {
    return {
      challenge: input.challenge,
      expiresAtLedger: input.expiresAtLedger,
      credentialId: input.credentialId,
      transports: input.transports,
      rpId: input.rpId,
      sellerAuthEntryXdr: input.sellerAuthEntryXdr,
      trade: { count: input.count, grossStroops: input.grossStroops, pricePerFractionStroops: input.pricePerFractionStroops },
    };
  }
}
