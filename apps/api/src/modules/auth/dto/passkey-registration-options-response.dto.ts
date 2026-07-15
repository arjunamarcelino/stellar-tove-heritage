import { ApiProperty } from '@nestjs/swagger';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';

/**
 * Wraps the WebAuthn registration options the browser passes to
 * `startRegistration({ optionsJSON })`. Wrapped (never the raw library object
 * returned bare) per the project's output-DTO convention.
 */
export class PasskeyRegistrationOptionsResponseDto {
  @ApiProperty({
    description: 'PublicKeyCredentialCreationOptionsJSON for navigator.credentials.create().',
  })
  options!: PublicKeyCredentialCreationOptionsJSON;

  static create(
    options: PublicKeyCredentialCreationOptionsJSON,
  ): PasskeyRegistrationOptionsResponseDto {
    const dto = new PasskeyRegistrationOptionsResponseDto();
    dto.options = options;
    return dto;
  }
}
