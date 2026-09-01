import { createHash } from 'node:crypto';
import { xdr, Address, TransactionBuilder, Transaction, scValToNative, scValToBigInt } from '@stellar/stellar-sdk';
import { computeHostPayloadHash, computeAuthDigest, invocationsEqual } from './auth-entry-encoding';
import { toLowSCompactSignature, verifyP256Assertion } from './secp256r1';
import { RelayerTransferError } from './relayer.errors';

const MAX_CLIENT_DATA_JSON = 4096;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

/**
 * Verify a passkey assertion authorizes exactly the `submit_bid` in `txXdr` (TOV-156). A deliberate
 * FORK of `verifyPasskeyAuthorization` (the audited TOV-22 transfer verifier is left untouched — its
 * tight golden-vector pins depend on the sub-invocation-BANNED flat shape, which `submit_bid` inverts).
 *
 * Differences from the transfer verifier: the root is `submit_bid` (4 args) on the offering's escrow
 * contract, and the auth tree carries EXACTLY ONE sub-invocation — the inner `usdc.transfer(bidder →
 * escrow, price*count)`. Every money-relevant value is EXACT-pinned to server-trusted inputs (price,
 * count, and the inner amount = price*count), not merely bounded by a cap (security H1). The challenge
 * (guard 4) commits to the full nested tree because `computeHostPayloadHash` XDR-serializes the whole
 * `rootInvocation` including sub-invocations. Pure — no RPC. Any failure throws a terminal
 * {@link RelayerTransferError} (`signature_required` / `signature_invalid`), which the caller maps to
 * `BID_SIGNATURE_REQUIRED` / `BID_SIGNATURE_INVALID`.
 */
export interface VerifyBidAuthorizationInput {
  txXdr: string;
  networkPassphrase: string;
  /** Server-trusted bidder smart-wallet (owner-scoped from the JWT) = the `from` of the inner transfer. */
  walletContract: string;
  /** Server-trusted offering escrow contract (from the offering row) = the root invocation target. */
  escrowContract: string;
  /** Server-trusted USDC SAC contract (config) = the inner transfer target. */
  tokenContract: string;
  contextRuleIds: number[];
  boundPublicKey: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signatureDer: Uint8Array;
  rpId: string;
  allowedOrigins: string[];
  /** Exact expected price (i128 stroops, decimal string) — args[1] must equal this. */
  expectedPriceScaled: string;
  /** Exact expected count (i128, decimal string) — args[2] must equal this. */
  expectedCount: string;
  /** Ceiling on the escrowed amount (price*count) as a decimal string — belt over the exact-pin. */
  maxCostScaled: string;
  /** The exact server-derived on-chain idempotency_key (BytesN<32>) that args[3] must equal (todo 297). */
  expectedIdemKey: Uint8Array;
}

export interface VerifiedBidAuthorization {
  tx: Transaction;
  authEntry: xdr.SorobanAuthorizationEntry;
  signatureCompact: Buffer;
  signatureExpirationLedger: number;
}

function invalid(message: string): RelayerTransferError {
  return new RelayerTransferError('signature_invalid', message);
}

function requireI128Equal(arg: xdr.ScVal, expected: bigint, label: string): void {
  if (arg.switch() !== xdr.ScValType.scvI128()) {
    throw invalid(`${label} is not an i128`);
  }
  if (scValToBigInt(arg) !== expected) {
    throw invalid(`${label} does not match the server-trusted value`);
  }
}

export function verifyBidAuthorization(input: VerifyBidAuthorizationInput): VerifiedBidAuthorization {
  // (0) Presence.
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
  if (Address.fromScAddress(addressCreds.address()).toString() !== input.walletContract) {
    throw invalid('auth entry address does not match the wallet');
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

  // (3a) Pin the submit_bid root to server-trusted values.
  if (opInvocation.functionName().toString() !== 'submit_bid') {
    throw invalid('unexpected contract function');
  }
  if (Address.fromScAddress(opInvocation.contractAddress()).toString() !== input.escrowContract) {
    throw invalid('unexpected escrow contract');
  }
  const args = opInvocation.args();
  if (args.length !== 4) {
    throw invalid('unexpected submit_bid argument count');
  }
  const bidderArg: unknown = scValToNative(args[0]);
  if (typeof bidderArg !== 'string' || bidderArg !== input.walletContract) {
    throw invalid('submit_bid bidder does not match the wallet');
  }
  requireI128Equal(args[1], BigInt(input.expectedPriceScaled), 'submit_bid price');
  requireI128Equal(args[2], BigInt(input.expectedCount), 'submit_bid count');
  if (args[3].switch() !== xdr.ScValType.scvBytes() || args[3].bytes().length !== 32) {
    throw invalid('submit_bid idempotency_key is not a BytesN<32>');
  }
  // Exact-pin the on-chain idem key to the server-derived value (todo 297) so the DB dedupe belt
  // (UQ_offering_bids_idem) and the contract's DuplicateBid guard key on the SAME value the server intends.
  if (!Buffer.from(args[3].bytes()).equals(Buffer.from(input.expectedIdemKey))) {
    throw invalid('submit_bid idempotency_key does not match the server-derived value');
  }

  // (3b) Pin the single inner usdc.transfer(bidder → escrow, price*count) sub-invocation.
  const subs = rootInvocation.subInvocations();
  if (subs.length !== 1) {
    throw invalid('expected exactly one sub-invocation (the escrow transfer)');
  }
  const subFn = subs[0].function();
  if (
    subFn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn() ||
    subs[0].subInvocations().length !== 0
  ) {
    throw invalid('malformed escrow-transfer sub-invocation');
  }
  const transfer = subFn.contractFn();
  if (transfer.functionName().toString() !== 'transfer') {
    throw invalid('sub-invocation is not a transfer');
  }
  if (Address.fromScAddress(transfer.contractAddress()).toString() !== input.tokenContract) {
    throw invalid('escrow transfer targets an unexpected token');
  }
  const tArgs = transfer.args();
  if (tArgs.length !== 3) {
    throw invalid('unexpected transfer argument count');
  }
  const tFrom: unknown = scValToNative(tArgs[0]);
  const tTo: unknown = scValToNative(tArgs[1]);
  if (typeof tFrom !== 'string' || tFrom !== input.walletContract) {
    throw invalid('escrow transfer `from` is not the bidder wallet');
  }
  if (typeof tTo !== 'string' || tTo !== input.escrowContract) {
    throw invalid('escrow transfer `to` is not the escrow contract');
  }
  const escrowAmount = BigInt(input.expectedPriceScaled) * BigInt(input.expectedCount);
  requireI128Equal(tArgs[2], escrowAmount, 'escrow transfer amount');
  if (escrowAmount > BigInt(input.maxCostScaled)) {
    throw invalid('escrow amount exceeds the maximum allowed');
  }

  // (4) Challenge binding over the FULL nested tree.
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
    throw invalid('challenge does not bind to this bid');
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
