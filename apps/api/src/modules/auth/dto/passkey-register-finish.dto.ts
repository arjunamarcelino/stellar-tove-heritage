import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsInt, IsIn, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import type {
  AuthenticationExtensionsClientOutputs,
  AuthenticatorAttachment,
  AuthenticatorAttestationResponseJSON,
  AuthenticatorTransportFuture,
  Base64URLString,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

/**
 * Nested WebAuthn attestation DTOs. They `implements` the `@simplewebauthn/server`
 * JSON types so the validated object is passed to `verifyRegistrationResponse`
 * WITHOUT a cast. Every field is declared so the global ValidationPipe
 * (whitelist + forbidNonWhitelisted) doesn't strip the attestation.
 */
class AuthenticatorAttestationResponseDto implements AuthenticatorAttestationResponseJSON {
  @IsString()
  clientDataJSON!: Base64URLString;

  @IsString()
  attestationObject!: Base64URLString;

  @IsOptional()
  @IsString()
  authenticatorData?: Base64URLString;

  @IsOptional()
  @IsString({ each: true })
  transports?: AuthenticatorTransportFuture[];

  @IsOptional()
  @IsInt()
  publicKeyAlgorithm?: number;

  @IsOptional()
  @IsString()
  publicKey?: Base64URLString;
}

class RegistrationResponseDto implements RegistrationResponseJSON {
  @IsString()
  id!: Base64URLString;

  @IsString()
  rawId!: Base64URLString;

  @ValidateNested()
  @Type(() => AuthenticatorAttestationResponseDto)
  response!: AuthenticatorAttestationResponseDto;

  @IsOptional()
  @IsIn(['cross-platform', 'platform'])
  authenticatorAttachment?: AuthenticatorAttachment;

  @IsObject()
  clientExtensionResults!: AuthenticationExtensionsClientOutputs;

  @IsIn(['public-key'])
  type!: 'public-key';
}

export class PasskeyRegisterFinishDto {
  @ApiProperty({
    description: 'Email the registration was begun with (must match the challenge).',
    example: 'collector@example.com',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'WebAuthn RegistrationResponseJSON from the browser authenticator (startRegistration).',
    type: RegistrationResponseDto,
  })
  @ValidateNested()
  @Type(() => RegistrationResponseDto)
  attestationResponse!: RegistrationResponseDto;
}
