import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers';
import type { CBORType } from '@levischuck/tiny-cbor';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

/**
 * A minimal software WebAuthn authenticator for tests -- the passkey analog of
 * SEP-10's real Stellar keypairs. Generates a real secp256r1/P-256 key and emits a
 * valid `fmt: 'none'` attestation (registration) + a `webauthn.get` assertion
 * (TOV-22 transfer signing) so tests run through the REAL crypto.
 */
export interface SoftwarePasskey {
  credentialId: Uint8Array;
  cosePublicKey: Uint8Array;
  privateKey: KeyObject;
}

export function createSoftwarePasskey(credentialId?: Uint8Array): SoftwarePasskey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const x = isoBase64URL.toBuffer(jwk.x, 'base64url');
  const y = isoBase64URL.toBuffer(jwk.y, 'base64url');

  // COSE_Key (EC2 / ES256 / P-256): kty=1->2, alg=3->-7, crv=-1->1, x=-2, y=-3.
  const coseMap = new Map<number, CBORType>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, x],
    [-3, y],
  ]);
  return {
    credentialId: credentialId ?? new Uint8Array(randomBytes(16)),
    cosePublicKey: isoCBOR.encode(coseMap),
    privateKey,
  };
}

export function buildAttestation(params: {
  passkey: SoftwarePasskey;
  challenge: string; // base64url, straight from options.challenge
  rpId: string;
  origin: string;
}): RegistrationResponseJSON {
  const { passkey, challenge, rpId, origin } = params;

  const rpIdHash = new Uint8Array(createHash('sha256').update(rpId).digest());
  const flags = new Uint8Array([0x45]); // UP | UV | AT
  const count = new Uint8Array(4); // signCount 0 (platform passkeys report 0)
  const aaguid = new Uint8Array(16);
  const credIdLen = new Uint8Array(2);
  new DataView(credIdLen.buffer).setUint16(0, passkey.credentialId.length, false);

  const authData = isoUint8Array.concat([
    rpIdHash,
    flags,
    count,
    aaguid,
    credIdLen,
    passkey.credentialId,
    passkey.cosePublicKey,
  ]);

  const attestationObject = isoCBOR.encode(
    new Map<string, CBORType>([
      ['fmt', 'none'],
      ['attStmt', new Map<string, CBORType>()],
      ['authData', authData],
    ]),
  );

  const clientDataJSON = isoBase64URL.fromBuffer(
    isoUint8Array.fromUTF8String(
      JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }),
    ),
  );

  const id = isoBase64URL.fromBuffer(passkey.credentialId);
  return {
    id,
    rawId: id,
    response: {
      clientDataJSON,
      attestationObject: isoBase64URL.fromBuffer(attestationObject),
      transports: ['internal'],
    },
    clientExtensionResults: {},
    type: 'public-key',
    authenticatorAttachment: 'platform',
  };
}

/**
 * Produce a `webauthn.get` assertion over `challenge` (base64url of the Soroban auth-digest), signing
 * with the passkey's real P-256 key. Returns the fields the transfer submit endpoint expects, all
 * base64url. authenticatorData flags = UP|UV|BE|BS (0x1d); the ECDSA signature is DER (the backend
 * low-S normalizes it).
 */
export function signAssertion(params: {
  passkey: SoftwarePasskey;
  challenge: string;
  rpId: string;
  origin: string;
  flags?: number;
}): { authenticatorData: string; clientDataJSON: string; signature: string } {
  const { passkey, challenge, rpId, origin, flags = 0x1d } = params;

  const rpIdHash = new Uint8Array(createHash('sha256').update(rpId).digest());
  const authData = isoUint8Array.concat([rpIdHash, new Uint8Array([flags]), new Uint8Array(4)]);
  const clientDataJSON = isoUint8Array.fromUTF8String(
    JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
  );

  // WebAuthn signs sha256(authenticatorData ‖ sha256(clientDataJSON)); Node applies the outer sha256.
  const message = isoUint8Array.concat([
    authData,
    new Uint8Array(createHash('sha256').update(clientDataJSON).digest()),
  ]);
  const signature = sign('sha256', message, { key: passkey.privateKey, dsaEncoding: 'der' });

  return {
    authenticatorData: isoBase64URL.fromBuffer(authData),
    clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
    signature: isoBase64URL.fromBuffer(signature),
  };
}
