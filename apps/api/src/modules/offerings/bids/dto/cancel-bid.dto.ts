import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsString, MaxLength, MinLength } from 'class-validator';
import { IsBase64Url } from '@common/validators/is-base64url.validator';

/**
 * Cancel a prepared bid with the round-tripped WebAuthn assertion (TOV-158, FR-05.04). The backend CAS-marks
 * the bid `canceling` and enqueues the on-chain `cancel_bid`; the worker re-verifies the assertion fail-closed
 * before the refund moves. Unlike {@link SubmitBidDto} there is NO `price`/`count` — `cancel_bid(caller,
 * bid_id)` carries no amount args; the server resolves `bid_id` from the caller's active escrowed bid and the
 * verifier exact-pins it against the signed tx. Tight per-field caps keep malformed input a clean 400.
 */
export class CancelBidDto {
  @ApiProperty({ description: 'The unsigned cancel_bid transaction from /cancel/prepare (base64 XDR)' })
  @IsString()
  @IsBase64()
  @MaxLength(8192)
  txXdr!: string;

  @ApiProperty({ description: 'WebAuthn authenticatorData (base64url)' })
  @IsBase64Url()
  @MinLength(48) // abuse-bounding (~36B); the authoritative `>= 37 raw bytes` check is in the verifier
  @MaxLength(2048)
  authenticatorData!: string;

  @ApiProperty({ description: 'WebAuthn clientDataJSON (base64url)' })
  @IsBase64Url()
  @MaxLength(4096)
  clientDataJSON!: string;

  @ApiProperty({ description: 'WebAuthn ECDSA signature, DER (base64url)' })
  @IsBase64Url()
  @MaxLength(256)
  signature!: string;
}
