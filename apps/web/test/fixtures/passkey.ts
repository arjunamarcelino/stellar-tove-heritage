import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';

export const fakeCreationOptions: PublicKeyCredentialCreationOptionsJSON = {
  rp: { name: 'Tove Heritage', id: 'toveheritage.com' },
  user: { id: 'dXNlcklk', name: 'leonardo@example.com', displayName: 'Leonardo' },
  challenge: 'Y2hhbGxlbmdl',
  pubKeyCredParams: [
    { type: 'public-key', alg: -7 },
    { type: 'public-key', alg: -257 },
  ],
  timeout: 60000,
  attestation: 'none',
  authenticatorSelection: {
    residentKey: 'required',
    requireResidentKey: true,
    userVerification: 'required',
  },
};

export const fakeRegistrationResponse: RegistrationResponseJSON = {
  id: 'credId',
  rawId: 'credId',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
    attestationObject: 'o2NmbXRkbm9uZQ',
    transports: ['internal'],
  },
  clientExtensionResults: {},
  type: 'public-key',
  authenticatorAttachment: 'platform',
};

// WebAuthn assertion (authentication) ceremony fixtures — used by the export signing flow.
export const fakeRequestOptions: PublicKeyCredentialRequestOptionsJSON = {
  challenge: 'Y2hhbGxlbmdl',
  timeout: 120000,
  rpId: 'toveheritage.com',
  userVerification: 'required',
  allowCredentials: [{ id: 'credId', type: 'public-key', transports: ['internal'] }],
};

export const fakeAssertionResponse: AuthenticationResponseJSON = {
  id: 'credId',
  rawId: 'credId',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
    authenticatorData: 'YXV0aERhdGE',
    signature: 'c2lnbmF0dXJl',
    userHandle: 'dXNlcklk',
  },
  clientExtensionResults: {},
  type: 'public-key',
  authenticatorAttachment: 'platform',
};

export const fakeTokens = {
  accessToken: 'access.jwt.token',
  refreshToken: 'refresh.jwt.token',
};

export const fakeContractAddress = 'CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBME';

// The finish 201 body: tokens + deployed wallet address.
export const fakeFinish201 = { ...fakeTokens, contractAddress: fakeContractAddress };

// Stub mirroring @simplewebauthn/browser's WebAuthnError shape. The SUT narrows with
// `instanceof WebAuthnError`, so tests must re-export THIS class as `WebAuthnError` from the
// module mock (plan test-skeleton gotcha #1).
export class FakeWebAuthnError extends Error {
  code: string;
  override cause: unknown;
  constructor(code: string, cause?: unknown) {
    super(code);
    this.name = 'WebAuthnError';
    this.code = code;
    this.cause = cause;
  }
}
