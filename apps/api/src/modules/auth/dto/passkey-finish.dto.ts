import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import type {
  AuthenticationExtensionsClientOutputs,
  AuthenticatorAssertionResponseJSON,
  AuthenticatorAttachment,
  AuthenticationResponseJSON,
  Base64URLString,
} from '@simplewebauthn/server';
import { RegistrationResponseDto } from './passkey-register-finish.dto';

/**
 * Nested WebAuthn assertion (login) DTOs, mirroring the attestation DTOs in
 * `passkey-register-finish.dto.ts`. They `implements` the `@simplewebauthn/server` JSON types so the
 * validated object is passed to `verifyAuthenticationResponse` WITHOUT a cast, and every field is
 * declared so the global ValidationPipe (whitelist + forbidNonWhitelisted) doesn't strip the assertion.
 */
class AuthenticatorAssertionResponseDto implements AuthenticatorAssertionResponseJSON {
  @IsString()
  clientDataJSON!: Base64URLString;

  @IsString()
  authenticatorData!: Base64URLString;

  @IsString()
  signature!: Base64URLString;

  @IsOptional()
  @IsString()
  userHandle?: Base64URLString;
}

export class AuthenticationResponseDto implements AuthenticationResponseJSON {
  @IsString()
  id!: Base64URLString;

  @IsString()
  rawId!: Base64URLString;

  @ValidateNested()
  @Type(() => AuthenticatorAssertionResponseDto)
  response!: AuthenticatorAssertionResponseDto;

  @IsOptional()
  @IsIn(['cross-platform', 'platform'])
  authenticatorAttachment?: AuthenticatorAttachment;

  @IsObject()
  clientExtensionResults!: AuthenticationExtensionsClientOutputs;

  @IsIn(['public-key'])
  type!: 'public-key';
}

/**
 * Unified finish body for `POST /auth/passkey/finish`. The client sends exactly ONE of:
 *  - `assertionResponse`   → LOGIN  (from navigator.credentials.get, when begin returned mode:'login')
 *  - `attestationResponse` → SIGNUP (from navigator.credentials.create, when begin returned mode:'signup')
 * The service infers the mode from which field is present (and rejects zero/both).
 */
export class PasskeyFinishDto {
  @ApiProperty({
    description: 'Email the ceremony was begun with (must match the challenge).',
    example: 'collector@example.com',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    description: 'WebAuthn AuthenticationResponseJSON (startAuthentication) — present for LOGIN.',
    type: AuthenticationResponseDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AuthenticationResponseDto)
  assertionResponse?: AuthenticationResponseDto;

  @ApiPropertyOptional({
    description: 'WebAuthn RegistrationResponseJSON (startRegistration) — present for SIGNUP.',
    type: RegistrationResponseDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationResponseDto)
  attestationResponse?: RegistrationResponseDto;
}
