import { createHash } from 'node:crypto';
import { xdr, Address, TransactionBuilder, Transaction, scValToNative, scValToBigInt } from '@stellar/stellar-sdk';
import { computeHostPayloadHash, computeAuthDigest, invocationsEqual } from './auth-entry-encoding';
import { toLowSCompactSignature, verifyP256Assertion } from './secp256r1';
import { RelayerTransferError } from './relayer.errors';

const MAX_CLIENT_DATA_JSON = 4096;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

export interface VerifyPasskeyAuthorizationInput {
  /** The unsigned transfer tx from `/build` (base64 XDR), round-tripped through the client. */
  txXdr: string;
  networkPassphrase: string;
  /** Server-trusted expected `from` wallet (owner-scoped from the JWT). */
  walletContract: string;
  /** Server-trusted expected token contract. */
  tokenContract: string;
  /** Context rule ids bound into the OZ auth-digest (`[0]` for MVP). */
  contextRuleIds: number[];
  /** The wallet's bound passkey public key, raw uncompressed P-256 (65 bytes). */
  boundPublicKey: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** DER ECDSA signature straight from the authenticator (normalized here). */
  signatureDer: Uint8Array;
  rpId: string;
  allowedOrigins: string[];
  /** Per-transfer ceiling (scaled i128 as a decimal string) — re-enforced here so a self-built tx
   * submitted directly (bypassing /build) can't exceed it (opaque-challenge compensating control). */
  maxTransferAmount: string;
  /**
   * Export only (TOV-40): when set, pin the transfer recipient (`to`, args[1]) to this exact
   * server-trusted address. The single-transfer surface (TOV-22) omits it — there the user chooses `to`.
   */
  expectedTo?: string;
  /**
   * Export only (TOV-40): when set, require the transfer amount (args[2]) to EXACTLY equal this frozen
   * snapshot value (not merely ≤ the ceiling), so one signed item can't authorize a different amount.
   */
  expectedAmountScaled?: string;
}

export interface VerifiedPasskeyAuthorization {
  /** The parsed transaction (already validated) — reused for submission so verification and the
   * signature attachment operate on ONE parse, not two independently-decoded copies. */
  tx: Transaction;
  /** The wallet's address-credentials auth entry (a live reference into `tx`) to attach the signature. */
  authEntry: xdr.SorobanAuthorizationEntry;
  /** Low-S normalized raw 64-byte `r‖s` signature — the exact bytes to submit. */
  signatureCompact: Buffer;
  /** The entry's signature expiry (for the submit-time expiry re-check). */
  signatureExpirationLedger: number;
}

function invalid(message: string): RelayerTransferError {
  return new RelayerTransferError('signature_invalid', message);
}

/**
 * Fail-closed verification that a passkey assertion authorizes exactly the transfer in `txXdr`, run
 * BEFORE the relayer submits (the "relayer refuses without a valid signature" invariant, TOV-22).
 * Pure — no RPC. All checks are enforced in order; any failure throws a terminal
 * {@link RelayerTransferError} (`signature_required` for a missing assertion, else `signature_invalid`).
 *
 * Guards, in order: presence → exactly one InvokeHostFunction op with exactly one Address-cred auth
 * entry for the wallet → op invocation is byte-equal to the auth entry's rootInvocation (no
 * sub-invocations) → `from`/token/function pinned to server-trusted values → clientDataJSON
 * (`webauthn.get`, challenge == base64url(OZ auth_digest), origin allow-listed, not crossOrigin) →
 * authenticatorData (rpIdHash, UP+UV) → low-S secp256r1 verify against the BOUND key over the exact
 * normalized bytes we will submit.
 */
export function verifyPasskeyAuthorization(
  input: VerifyPasskeyAuthorizationInput,
): VerifiedPasskeyAuthorization {
  // (0) Presence — defense-in-depth: an accidental no-signature path is refused explicitly.
  if (!input.authenticatorData.length || !input.clientDataJSON.length || !input.signatureDer.length) {
    throw new RelayerTransferError('signature_required');
  }

  // (1) Exactly one InvokeHostFunction op carrying exactly one Address-cred auth entry for the wallet.
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(input.txXdr, input.networkPassphrase);
  } catch {
    throw invalid('malformed txXdr');
  }
  // `instanceof Transaction` (not `'operations' in tx`) so the narrowing away of FeeBumpTransaction
  // persists to the returned `tx`.
  if (!(tx instanceof Transaction) || tx.operations.length !== 1) {
    throw invalid('expected exactly one operation');
  }
  const op = tx.operations[0];
  if (op.type !== 'invokeHostFunction') {
    throw invalid('operation is not invokeHostFunction');
  }
  const authEntries = op.auth ?? [];
  if (authEntries.length !== 1) {
    throw invalid('expected exactly one auth entry');
  }
  const authEntry = authEntries[0];
  if (authEntry.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
    throw invalid('auth entry is not address credentials');
  }
  const addressCreds = authEntry.credentials().address();
  if (Address.fromScAddress(addressCreds.address()).toString() !== input.walletContract) {
    throw invalid('auth entry address does not match the wallet');
  }

  // (2) Op invocation byte-equal to the auth entry's rootInvocation (no sub-invocations).
  const rootInvocation = authEntry.rootInvocation();
  if (rootInvocation.subInvocations().length !== 0) {
    throw invalid('unexpected sub-invocations');
  }
  const rootFn = rootInvocation.function();
  if (rootFn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()) {
    throw invalid('auth entry is not a contract invocation');
  }
  // `op.type === 'invokeHostFunction'` guards the OPERATION, but `op.func` is an xdr.HostFunction
  // union (invokeContract / createContract / uploadWasm / …); its arm accessors THROW on the wrong
  // arm. Guard the discriminant so a crafted create-contract host function is a clean refusal, not a
  // raw throw that escapes the fail-closed RelayerTransferError contract.
  if (op.func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    throw invalid('host function is not a contract invocation');
  }
  const opInvocation = op.func.invokeContract();
  if (!invocationsEqual(opInvocation, rootFn.contractFn())) {
    throw invalid('operation does not match the authorized invocation');
  }

  // (3) Pin identity to server-trusted values (never the request body).
  if (opInvocation.functionName().toString() !== 'transfer') {
    throw invalid('unexpected contract function');
  }
  if (Address.fromScAddress(opInvocation.contractAddress()).toString() !== input.tokenContract) {
    throw invalid('unexpected token contract');
  }
  const args = opInvocation.args();
  if (args.length !== 3) {
    throw invalid('unexpected transfer argument count');
  }
  // `from` (args[0]) must decode to a string address equal to the wallet. `scValToNative` returns
  // `any`, so assert the shape explicitly before comparing — a non-address ScVal must be a clean
  // refusal, not a silently-false comparison.
  const fromArg: unknown = scValToNative(args[0]);
  if (typeof fromArg !== 'string' || fromArg !== input.walletContract) {
    throw invalid('transfer `from` does not match the wallet');
  }
  // `to` (args[1]) must decode to an address string (the user signed it, but reject a non-address
  // ScVal defensively so a self-built tx can't smuggle a malformed recipient past submit).
  const toArg: unknown = scValToNative(args[1]);
  if (typeof toArg !== 'string') {
    throw invalid('transfer recipient is not an address');
  }
  // Export (TOV-40): pin `to` to the server-trusted allowlisted target — the submitted tx's recipient
  // is NOT trusted; it must equal the frozen export target, or the KYC allowlist is bypassable here.
  if (input.expectedTo !== undefined && toArg !== input.expectedTo) {
    throw invalid('transfer recipient does not match the export target');
  }
  // Amount (args[2]) MUST be an i128. Guard the discriminant before reading — `scValToNative(args[2])
  // as bigint` was an unchecked cast: a non-i128 ScVal would throw a raw `TypeError` on the ceiling
  // comparison (escaping the fail-closed contract as a 503). Re-enforced at submit so a self-built tx
  // can't bypass /build's ceiling check.
  if (args[2].switch() !== xdr.ScValType.scvI128()) {
    throw invalid('transfer amount is not an i128');
  }
  const amount = scValToBigInt(args[2]);
  if (amount > BigInt(input.maxTransferAmount)) {
    throw invalid('amount exceeds the maximum allowed');
  }
  // Export (TOV-40): require the EXACT frozen snapshot amount, so a signature for one item can't
  // authorize a different amount (or another item's amount).
  if (input.expectedAmountScaled !== undefined && amount !== BigInt(input.expectedAmountScaled)) {
    throw invalid('transfer amount does not match the export item');
  }

  // (4) Challenge binding: clientDataJSON.challenge == base64url(OZ auth_digest for THIS entry).
  if (input.clientDataJSON.length > MAX_CLIENT_DATA_JSON) {
    throw invalid('clientDataJSON too large');
  }
  let clientData: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    clientData = JSON.parse(Buffer.from(input.clientDataJSON).toString('utf8')) as typeof clientData;
  } catch {
    throw invalid('malformed clientDataJSON');
  }
  const hostPayload = computeHostPayloadHash(
    input.networkPassphrase,
    addressCreds.nonce(),
    addressCreds.signatureExpirationLedger(),
    rootInvocation,
  );
  const expectedChallenge = computeAuthDigest(hostPayload, input.contextRuleIds).toString('base64url');
  if (clientData.type !== 'webauthn.get') {
    throw invalid('clientDataJSON type is not webauthn.get');
  }
  if (clientData.challenge !== expectedChallenge) {
    throw invalid('challenge does not bind to this transfer');
  }
  if (clientData.crossOrigin === true) {
    throw invalid('cross-origin assertion');
  }
  if (typeof clientData.origin !== 'string' || !input.allowedOrigins.includes(clientData.origin)) {
    throw invalid('origin is not allow-listed');
  }

  // (5) authenticatorData: rpIdHash + user presence + user verification (money move).
  if (input.authenticatorData.length < 37) {
    throw invalid('authenticatorData too short');
  }
  const rpIdHash = Buffer.from(input.authenticatorData.subarray(0, 32));
  if (!rpIdHash.equals(createHash('sha256').update(input.rpId).digest())) {
    throw invalid('rpIdHash mismatch');
  }
  const flags = input.authenticatorData[32];
  if ((flags & FLAG_UP) === 0) {
    throw invalid('user-presence flag not set');
  }
  if ((flags & FLAG_UV) === 0) {
    throw invalid('user-verification flag not set');
  }

  // (6) Integrity: low-S normalize, then verify the exact submitted bytes against the BOUND key.
  // Both the normalize and the verify can throw (malformed signature / malformed bound key) — keep
  // ANY throw inside the fail-closed contract (a raw Error would otherwise escape as a 503).
  let verified: boolean;
  let signatureCompact: Buffer;
  try {
    signatureCompact = toLowSCompactSignature(input.signatureDer);
    verified = verifyP256Assertion(
      input.boundPublicKey,
      input.authenticatorData,
      input.clientDataJSON,
      signatureCompact,
    );
  } catch {
    throw invalid('signature verification failed');
  }
  if (!verified) {
    throw invalid('signature verification failed');
  }

  return {
    tx,
    authEntry,
    signatureCompact,
    signatureExpirationLedger: addressCreds.signatureExpirationLedger(),
  };
}
