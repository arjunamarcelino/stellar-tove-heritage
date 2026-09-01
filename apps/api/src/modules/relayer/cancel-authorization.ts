import { createHash } from 'node:crypto';
import { xdr, Address, TransactionBuilder, Transaction, scValToNative } from '@stellar/stellar-sdk';
import { computeHostPayloadHash, computeAuthDigest, invocationsEqual } from './auth-entry-encoding';
import { toLowSCompactSignature, verifyP256Assertion } from './secp256r1';
import { RelayerTransferError } from './relayer.errors';

const MAX_CLIENT_DATA_JSON = 4096;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

/**
 * Verify a passkey assertion authorizes exactly the `cancel_bid` in `txXdr` (TOV-158). A FORK of
 * `verifyBidAuthorization` — steps 0/1/2/4/5/6 are identical (presence; one op + one Address cred, reject
 * SOURCE_ACCOUNT; root-is-contract-fn byte-equal; challenge binding over the tree; authenticatorData UP/UV;
 * P256 integrity). Step 3 differs: the root is `cancel_bid(caller, bid_id)` (2 args) and the auth tree is
 * **root-only — ZERO sub-invocations** (the refund `usdc.transfer(escrow → bidder)` is authorized by the
 * escrow contract's own credential, not the caller's signed tree). Every identity is EXACT-pinned to
 * server-trusted values: escrow contract, `caller == the recorded collector_wallet`, and `bid_id == the
 * recorded chain_bid_id`. Pure — no RPC. Any failure throws a terminal {@link RelayerTransferError}.
 */
export interface VerifyCancelBidAuthorizationInput {
  txXdr: string;
  networkPassphrase: string;
  /** Server-trusted bidder smart-wallet = the recorded `bid.collector_wallet` = the on-chain `caller`. */
  expectedCaller: string;
  /** Server-trusted offering escrow contract (from the offering row) = the root invocation target. */
  escrowContract: string;
  contextRuleIds: number[];
  boundPublicKey: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signatureDer: Uint8Array;
  rpId: string;
  allowedOrigins: string[];
  /** The exact on-chain bid_id (u32) the caller may cancel — args[1] must equal this (server-trusted). */
  expectedBidId: number;
}

export interface VerifiedCancelBidAuthorization {
  tx: Transaction;
  authEntry: xdr.SorobanAuthorizationEntry;
  signatureCompact: Buffer;
  signatureExpirationLedger: number;
}

function invalid(message: string): RelayerTransferError {
  return new RelayerTransferError('signature_invalid', message);
}

/** u32-native exact-equal (NOT the i128 helper — `scValToBigInt` would compare a bigint to a number). */
function requireU32Equal(arg: xdr.ScVal, expected: number, label: string): void {
  if (arg.switch() !== xdr.ScValType.scvU32()) {
    throw invalid(`${label} is not a u32`);
  }
  if (arg.u32() !== expected) {
    throw invalid(`${label} does not match the server-trusted value`);
  }
}

export function verifyCancelBidAuthorization(
  input: VerifyCancelBidAuthorizationInput,
): VerifiedCancelBidAuthorization {
  // (0) Presence.
  if (!input.authenticatorData.length || !input.clientDataJSON.length || !input.signatureDer.length) {
    throw new RelayerTransferError('signature_required');
  }

  // (1) Exactly one InvokeHostFunction op carrying exactly one Address-cred auth entry for the caller.
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(input.txXdr, input.networkPassphrase);
  } catch {
    throw invalid('malformed txXdr');
  }
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
  // Reject SOURCE_ACCOUNT credentials (confused-deputy: the relayer is the source) — require Address.
  if (authEntry.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
    throw invalid('auth entry is not address credentials');
  }
  const addressCreds = authEntry.credentials().address();
  if (Address.fromScAddress(addressCreds.address()).toString() !== input.expectedCaller) {
    throw invalid('auth entry address does not match the caller');
  }

  // (2) Root invocation is a contract fn; the op invocation binds to it (byte-equal).
  const rootInvocation = authEntry.rootInvocation();
  const rootFn = rootInvocation.function();
  if (rootFn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()) {
    throw invalid('auth entry is not a contract invocation');
  }
  if (op.func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    throw invalid('host function is not a contract invocation');
  }
  const opInvocation = op.func.invokeContract();
  if (!invocationsEqual(opInvocation, rootFn.contractFn())) {
    throw invalid('operation does not match the authorized invocation');
  }

  // (3) Pin the cancel_bid root to server-trusted values, and assert it is ROOT-ONLY (no sub-invocations).
  if (opInvocation.functionName().toString() !== 'cancel_bid') {
    throw invalid('unexpected contract function');
  }
  if (Address.fromScAddress(opInvocation.contractAddress()).toString() !== input.escrowContract) {
    throw invalid('unexpected escrow contract');
  }
  const args = opInvocation.args();
  if (args.length !== 2) {
    throw invalid('unexpected cancel_bid argument count');
  }
  const callerArg: unknown = scValToNative(args[0]);
  if (typeof callerArg !== 'string' || callerArg !== input.expectedCaller) {
    throw invalid('cancel_bid caller does not match the recorded bidder');
  }
  requireU32Equal(args[1], input.expectedBidId, 'cancel_bid bid_id');
  // The refund transfer is authorized by the escrow contract's own credential, NOT the caller's tree.
  if (rootInvocation.subInvocations().length !== 0) {
    throw invalid('cancel_bid must have no sub-invocations');
  }

  // (4) Challenge binding over the (root-only) tree.
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
    throw invalid('challenge does not bind to this cancel');
  }
  if (clientData.crossOrigin === true) {
    throw invalid('cross-origin assertion');
  }
  if (typeof clientData.origin !== 'string' || !input.allowedOrigins.includes(clientData.origin)) {
    throw invalid('origin is not allow-listed');
  }

  // (5) authenticatorData: rpIdHash + user presence + user verification.
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
