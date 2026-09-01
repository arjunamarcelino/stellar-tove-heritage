import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IsBase64Url } from '@common/validators/is-base64url.validator';
import { STROOPS_RE } from '@common/constants/stroops.constant';

/**
 * Submit a prepared bid with the round-tripped WebAuthn assertion (TOV-156). The backend records the bid
 * and enqueues the on-chain `submit_bid`; the worker re-verifies the assertion fail-closed before any
 * funds move. `price`/`count` are re-sent so the server re-validates the band + records the row; the
 * verifier EXACT-pins them against the signed tx, so they can't diverge from what was authorized. Tight
 * per-field caps keep malformed input a clean 400 (never a 500) — mirrors `SubmitTransferDto`.
 */
export class SubmitBidDto {
  @ApiProperty({ description: 'Bid price per fraction in USDC stroops (must match the prepared tx)', example: '100000000' })
  @IsString()
  @MaxLength(39)
  @Matches(STROOPS_RE, { message: 'price must be a canonical stroops integer' })
  price!: string;

  @ApiProperty({ description: 'Number of fractions (must match the prepared tx)', example: 10 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  count!: number;

  @ApiProperty({ description: 'The unsigned submit_bid transaction from /prepare (base64 XDR)' })
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
