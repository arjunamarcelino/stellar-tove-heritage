import { ApiProperty } from '@nestjs/swagger';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';

/** Which WebAuthn ceremony the client must run for this email. */
export type PasskeyMode = 'login' | 'signup';

/**
 * Response for the unified email-first `POST /auth/passkey/begin`. The backend decides, from whether
 * the email already has a passkey account, whether the client should run an AUTHENTICATION ceremony
 * (`mode: 'login'` → `navigator.credentials.get(options)`) or a REGISTRATION ceremony
 * (`mode: 'signup'` → `navigator.credentials.create(options)`). The frontend branches only on `mode`.
 */
export class PasskeyBeginResponseDto {
  @ApiProperty({
    enum: ['login', 'signup'],
    description:
      "'login' → existing passkey account (call navigator.credentials.get). " +
      "'signup' → new account (call navigator.credentials.create).",
  })
  mode!: PasskeyMode;

  @ApiProperty({
    description:
      'WebAuthn options for the ceremony indicated by `mode`: ' +
      'PublicKeyCredentialRequestOptionsJSON for login, PublicKeyCredentialCreationOptionsJSON for signup.',
  })
  options!: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON;

  static login(options: PublicKeyCredentialRequestOptionsJSON): PasskeyBeginResponseDto {
    const dto = new PasskeyBeginResponseDto();
    dto.mode = 'login';
    dto.options = options;
    return dto;
  }

  static signup(options: PublicKeyCredentialCreationOptionsJSON): PasskeyBeginResponseDto {
    const dto = new PasskeyBeginResponseDto();
    dto.mode = 'signup';
    dto.options = options;
    return dto;
  }
}
