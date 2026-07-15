import { xdr, nativeToScVal, hash, Address } from '@stellar/stellar-sdk';

/**
 * Soroban authorization-entry encoding for the passkey-signed transfer (TOV-22), targeting the
 * deployed wallet's format: **OpenZeppelin `stellar-accounts` v0.7.2** (verified against
 * `tove-contract@dev`), NOT kalepail smart-account-kit.
 *
 * ⚠️ The passkey does NOT sign the raw Soroban auth-entry preimage. OZ's `do_check_auth` derives
 * `auth_digest = sha256(host_payload ‖ xdr(context_rule_ids))` and the signers sign THAT. The
 * WebAuthn challenge is therefore `base64url(auth_digest)`. This binding + the exact `AuthPayload`
 * ScVal shape are pending a live-testnet cross-check (golden vector) against the deployed wallet.
 */

/**
 * The Default context rule id a freshly-deployed Tove wallet uses. Verified: OZ `NextId` starts at 0
 * and the wallet `__constructor` adds exactly one Default rule, so a single-context transfer uses
 * `[0]`. (Harden later by reading the wallet's rules; see the plan's open item.)
 */
export const DEFAULT_CONTEXT_RULE_ID = 0;

// networkId = sha256(networkPassphrase) is fixed per network — memoize it (called twice per transfer:
// build + verify) instead of re-hashing the passphrase every time.
const networkIdCache = new Map<string, Buffer>();
function networkId(networkPassphrase: string): Buffer {
  let id = networkIdCache.get(networkPassphrase);
  if (!id) {
    id = hash(Buffer.from(networkPassphrase));
    networkIdCache.set(networkPassphrase, id);
  }
  return id;
}

/**
 * The 32-byte Soroban authorization-entry preimage hash (`host_payload`):
 * `sha256(HashIdPreimage.envelopeTypeSorobanAuthorization({ networkId, nonce, invocation, expLedger }))`.
 * This is format-independent (standard Soroban), reused verbatim from the built-in `authorizeEntry`.
 */
export function computeHostPayloadHash(
  networkPassphrase: string,
  nonce: xdr.Int64,
  signatureExpirationLedger: number,
  rootInvocation: xdr.SorobanAuthorizedInvocation,
): Buffer {
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: networkId(networkPassphrase),
      nonce,
      signatureExpirationLedger,
      invocation: rootInvocation,
    }),
  );
  return hash(preimage.toXDR());
}

/**
 * The OZ auth-digest the passkey actually signs: `sha256(host_payload ‖ xdr(Vec<u32> context_rule_ids))`.
 * The WebAuthn challenge is `base64url` of the returned bytes.
 */
export function computeAuthDigest(hostPayloadHash: Buffer, contextRuleIds: number[]): Buffer {
  const contextRuleIdsXdr = nativeToScVal(contextRuleIds, { type: 'u32' }).toXDR();
  return hash(Buffer.concat([hostPayloadHash, contextRuleIdsXdr]));
}

/**
 * Whether two contract invocations are byte-equal (canonical XDR). Used at submit to bind the
 * executed operation to the signed auth entry — a Soroban tx carries the invocation in both the
 * operation and the auth entry, and only the auth-entry copy is covered by the signature.
 */
export function invocationsEqual(a: xdr.InvokeContractArgs, b: xdr.InvokeContractArgs): boolean {
  return Buffer.from(a.toXDR()).equals(Buffer.from(b.toXDR()));
}

export interface AuthPayloadInput {
  /** WebAuthn (secp256r1) verifier contract (C-StrKey) — the deploy-time signer's verifier. */
  verifierAddress: string;
  /** Signer key_data = pubkey65 ‖ credentialId, byte-identical to the deploy-time signer. */
  keyData: Uint8Array;
  /** Low-S normalized raw 64-byte `r‖s` signature. */
  signature: Uint8Array;
  /** Raw WebAuthn authenticatorData bytes. */
  authenticatorData: Uint8Array;
  /** Raw WebAuthn clientDataJSON bytes. */
  clientDataJSON: Uint8Array;
  /** Context rule ids the transfer authorizes (aligned with auth_contexts; `[0]` for MVP). */
  contextRuleIds: number[];
}

/**
 * Encode the OZ `AuthPayload` ScVal set on `credentials.address().signature()` (verified against the
 * TOV-39 golden vector byte-for-byte):
 *   AuthPayload { signers: Map<Signer, Bytes>, context_rule_ids: Vec<u32> }
 *   WebAuthnSigData { signature: BytesN<64>, authenticator_data: Bytes, client_data: Bytes }  // XDR -> the Bytes value
 * `signers` is keyed by the byte-identical deploy-time `Signer::External(verifier, key_data)`; OZ
 * looks signers up by `sha256(XDR(Signer))`, so any byte drift = `UnauthorizedSigner`. The
 * `Map<Signer, Bytes>` is built manually (nativeToScVal can't key a map by a complex ScVal); with a
 * single passkey signer the one entry needs no sort. The two struct ScMaps get their symbol keys
 * auto-sorted by `nativeToScVal`.
 */
export function encodeAuthPayloadScVal(input: AuthPayloadInput): xdr.ScVal {
  const webAuthnSigData = nativeToScVal(
    {
      authenticator_data: Buffer.from(input.authenticatorData),
      client_data: Buffer.from(input.clientDataJSON),
      signature: Buffer.from(input.signature),
    },
    {
      type: {
        authenticator_data: ['symbol', 'bytes'],
        client_data: ['symbol', 'bytes'],
        signature: ['symbol', 'bytes'],
      },
    },
  );

  const signerKey = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    Address.fromString(input.verifierAddress).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(input.keyData)),
  ]);
  const signers = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: signerKey, val: xdr.ScVal.scvBytes(webAuthnSigData.toXDR()) }),
  ]);

  // AuthPayload struct: symbol keys ascending (`context_rule_ids` < `signers`).
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: nativeToScVal(input.contextRuleIds, { type: 'u32' }),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signers'), val: signers }),
  ]);
}
