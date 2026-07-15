import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of building an unsigned transfer. The client drives `navigator.credentials.get` with
 * `challenge` (base64url of the OZ auth-digest), scoped to `credentialId`/`transports`, then submits
 * the assertion. `amount`/`amountScaled` echo what will be authorized for on-device confirmation.
 */
export class BuildTransferResponseDto {
  @ApiProperty({ description: 'Unsigned transfer transaction (base64 XDR) to sign + submit' })
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

  @ApiProperty({ description: 'Recipient address (echo of the request)' })
  to!: string;

  @ApiProperty({ description: 'Human amount (echo of the request)' })
  amount!: string;

  @ApiProperty({ description: 'Scaled i128 amount as a decimal string (avoid precision loss)', type: String })
  amountScaled!: string;

  static create(data: {
    txXdr: string;
    challenge: string;
    expiresAtLedger: number;
    credentialId: string;
    transports: string | null;
    rpId: string;
    to: string;
    amount: string;
    amountScaled: string;
  }): BuildTransferResponseDto {
    const dto = new BuildTransferResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
