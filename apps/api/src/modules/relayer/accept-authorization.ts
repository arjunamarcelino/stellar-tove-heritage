import { createHash } from 'node:crypto';
import { xdr, Address, TransactionBuilder, Transaction, scValToNative, scValToBigInt } from '@stellar/stellar-sdk';
import { computeHostPayloadHash, computeAuthDigest } from './auth-entry-encoding';
import { toLowSCompactSignature, verifyP256Assertion } from './secp256r1';
import { computeUsdcSplit } from './accept-quote-invocation';
import { RelayerTransferError } from './relayer.errors';

const MAX_CLIENT_DATA_JSON = 4096;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

function invalid(message: string): RelayerTransferError {
  return new RelayerTransferError('signature_invalid', message);
}

function requireI128Equal(arg: xdr.ScVal, expected: bigint, label: string): void {
  if (arg.switch() !== xdr.ScValType.scvI128()) throw invalid(`${label} is not an i128`);
  if (scValToBigInt(arg) !== expected) throw invalid(`${label} does not match the server-trusted value`);
}

function requireBytes32Equal(arg: xdr.ScVal, expected: Uint8Array, label: string): void {
  if (arg.switch() !== xdr.ScValType.scvBytes() || arg.bytes().length !== 32) {
    throw invalid(`${label} is not a BytesN<32>`);
  }
  if (!Buffer.from(arg.bytes()).equals(Buffer.from(expected))) {
    throw invalid(`${label} does not match the server-trusted value`);
  }
}

/** Server-trusted economic tuple both authorized roots (buyer + seller) must carry (require_auth_for_args). */
export interface AcceptTupleTrusted {
  settlerContract: string;
  rfqId: Uint8Array;
  quoteId: Uint8Array;
  artworkId: Uint8Array;
  expectedCount: string;
  expectedGross: string;
}

/** Assert an auth entry's root is `accept_quote`(5-tuple) on the settler, matching server-trusted values. */
function assertAcceptRoot(
  entry: xdr.SorobanAuthorizationEntry,
  t: AcceptTupleTrusted,
  label: string,
): xdr.SorobanAuthorizedInvocation {
  const root = entry.rootInvocation();
  const rootFn = root.function();
  if (rootFn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()) {
    throw invalid(`${label} root is not a contract invocation`);
  }
  const fn = rootFn.contractFn();
  if (fn.functionName().toString() !== 'accept_quote') throw invalid(`${label} root is not accept_quote`);
  if (Address.fromScAddress(fn.contractAddress()).toString() !== t.settlerContract) {
    throw invalid(`${label} root targets an unexpected settler`);
  }
  const a = fn.args();
  if (a.length !== 5) throw invalid(`${label} root is not the require_auth_for_args 5-tuple`);
  requireBytes32Equal(a[0], t.rfqId, `${label} rfq_id`);
  requireBytes32Equal(a[1], t.quoteId, `${label} quote_id`);
  requireBytes32Equal(a[2], t.artworkId, `${label} artwork_id`);
  requireI128Equal(a[3], BigInt(t.expectedCount), `${label} count`);
  requireI128Equal(a[4], BigInt(t.expectedGross), `${label} gross`);
  return root;
}

/** Address-credentials pin: the entry authorizes `wallet` (reject SOURCE_ACCOUNT). */
function assertEntryForWallet(entry: xdr.SorobanAuthorizationEntry, wallet: string, label: string): xdr.SorobanAddressCredentials {
  if (entry.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
    throw invalid(`${label} is not an address-credential auth entry`);
  }
  const creds = entry.credentials().address();
  if (Address.fromScAddress(creds.address()).toString() !== wallet) throw invalid(`${label} address does not match the wallet`);
  return creds;
}

/** The passkey-assertion fields common to the buyer (two-entry) and seller (single-entry) verifiers. */
export interface PasskeyAssertion {
  contextRuleIds: number[];
  boundPublicKey: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signatureDer: Uint8Array;
  rpId: string;
  allowedOrigins: string[];
}

/** Verify a WebAuthn assertion binds to `root` (via the OZ auth-digest) and is a valid low-S P256 signature. */
function verifyPasskeyOverRoot(
  a: PasskeyAssertion,
  networkPassphrase: string,
  creds: xdr.SorobanAddressCredentials,
  root: xdr.SorobanAuthorizedInvocation,
): Buffer {
  if (!a.authenticatorData.length || !a.clientDataJSON.length || !a.signatureDer.length) {
    throw new RelayerTransferError('signature_required');
  }
  if (a.clientDataJSON.length > MAX_CLIENT_DATA_JSON) throw invalid('clientDataJSON too large');
  let clientData: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    clientData = JSON.parse(Buffer.from(a.clientDataJSON).toString('utf8')) as typeof clientData;
  } catch {
    throw invalid('malformed clientDataJSON');
  }
  const hostPayload = computeHostPayloadHash(networkPassphrase, creds.nonce(), creds.signatureExpirationLedger(), root);
  const expectedChallenge = computeAuthDigest(hostPayload, a.contextRuleIds).toString('base64url');
  if (clientData.type !== 'webauthn.get') throw invalid('clientDataJSON type is not webauthn.get');
  if (clientData.challenge !== expectedChallenge) throw invalid('challenge does not bind to this trade');
  if (clientData.crossOrigin === true) throw invalid('cross-origin assertion');
  if (typeof clientData.origin !== 'string' || !a.allowedOrigins.includes(clientData.origin)) {
    throw invalid('origin is not allow-listed');
  }
  if (a.authenticatorData.length < 37) throw invalid('authenticatorData too short');
  const rpIdHash = Buffer.from(a.authenticatorData.subarray(0, 32));
  if (!rpIdHash.equals(createHash('sha256').update(a.rpId).digest())) throw invalid('rpIdHash mismatch');
  const flags = a.authenticatorData[32];
  if ((flags & FLAG_UP) === 0) throw invalid('user-presence flag not set');
  if ((flags & FLAG_UV) === 0) throw invalid('user-verification flag not set');
  let verified: boolean;
  let signatureCompact: Buffer;
  try {
    signatureCompact = toLowSCompactSignature(a.signatureDer);
    verified = verifyP256Assertion(a.boundPublicKey, a.authenticatorData, a.clientDataJSON, signatureCompact);
  } catch {
    throw invalid('signature verification failed');
  }
  if (!verified) throw invalid('signature verification failed');
  return signatureCompact;
}

// ── The two-entry buyer-accept verifier (submit) ─────────────────────────────────────────────────────────

/**
 * Verify the two-signature `accept_quote` in `txXdr` (TOV-177) — the NET-NEW two-authorizer verifier (every
 * prior verifier asserts exactly ONE entry). Because the contract uses `require_auth_for_args`, each
 * authorized root carries the **5-tuple** `(rfq_id, quote_id, artwork_id, count, gross)`, NOT the operation's
 * 7 call args — so the bid verifier's `invocationsEqual(op, root)` check does NOT apply here; the op's 7 args
 * and each root's 5-tuple are pinned separately. Pins the buyer's USDC subtree (all legs `from = buyer`,
 * Σ = gross, seller-net leg → seller) and verifies the BUYER's low-S WebAuthn assertion. The seller entry is
 * already signed (authorize step); its structure/expiry are checked here, its signature by the on-chain
 * __check_auth. The exact treasury/artist recipients are additionally pinned by the enforcing re-simulation
 * in `submitSignedAcceptQuote`. Pure — no RPC.
 */
export interface VerifyAcceptQuoteAuthorizationInput extends PasskeyAssertion, AcceptTupleTrusted {
  txXdr: string;
  networkPassphrase: string;
  usdcContract: string;
  buyerWallet: string;
  sellerWallet: string;
}

export interface VerifiedAcceptQuoteAuthorization {
  tx: Transaction;
  buyerAuthEntry: xdr.SorobanAuthorizationEntry;
  buyerSignatureCompact: Buffer;
  buyerSignatureExpirationLedger: number;
  sellerSignatureExpirationLedger: number;
}

function pickEntry(entries: xdr.SorobanAuthorizationEntry[], wallet: string, label: string): xdr.SorobanAuthorizationEntry {
  const matches = entries.filter(
    (e) =>
      e.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress() &&
      Address.fromScAddress(e.credentials().address().address()).toString() === wallet,
  );
  if (matches.length !== 1) throw invalid(`expected exactly one ${label} address-credential auth entry`);
  return matches[0];
}

export function verifyAcceptQuoteAuthorization(
  input: VerifyAcceptQuoteAuthorizationInput,
): VerifiedAcceptQuoteAuthorization {
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(input.txXdr, input.networkPassphrase);
  } catch {
    throw invalid('malformed txXdr');
  }
  if (!(tx instanceof Transaction) || tx.operations.length !== 1) throw invalid('expected exactly one operation');
  const op = tx.operations[0];
  if (op.type !== 'invokeHostFunction') throw invalid('operation is not invokeHostFunction');
  if (op.func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    throw invalid('host function is not a contract invocation');
  }

  const authEntries = op.auth ?? [];
  if (authEntries.length !== 2) throw invalid('expected exactly two auth entries (buyer + seller)');
  const buyerEntry = pickEntry(authEntries, input.buyerWallet, 'buyer');
  const sellerEntry = pickEntry(authEntries, input.sellerWallet, 'seller');

  // The operation itself is accept_quote(7 args) on the settler, matching server-trusted values.
  const opInv = op.func.invokeContract();
  if (opInv.functionName().toString() !== 'accept_quote') throw invalid('operation is not accept_quote');
  if (Address.fromScAddress(opInv.contractAddress()).toString() !== input.settlerContract) {
    throw invalid('operation targets an unexpected settler');
  }
  const oa = opInv.args();
  if (oa.length !== 7) throw invalid('unexpected accept_quote argument count');
  requireBytes32Equal(oa[0], input.rfqId, 'op rfq_id');
  requireBytes32Equal(oa[1], input.quoteId, 'op quote_id');
  requireBytes32Equal(oa[2], input.artworkId, 'op artwork_id');
  if ((scValToNative(oa[3]) as unknown) !== input.buyerWallet) throw invalid('op buyer does not match the wallet');
  if ((scValToNative(oa[4]) as unknown) !== input.sellerWallet) throw invalid('op seller does not match the wallet');
  requireI128Equal(oa[5], BigInt(input.expectedCount), 'op count');
  requireI128Equal(oa[6], BigInt(input.expectedGross), 'op gross');

  const buyerRoot = assertAcceptRoot(buyerEntry, input, 'buyer');
  assertAcceptRoot(sellerEntry, input, 'seller');
  if (sellerEntry.rootInvocation().subInvocations().length !== 0) {
    throw invalid('seller auth tree must have no sub-invocations');
  }

  // The buyer subtree = usdc.transfer legs, all `from = buyer`, Σ = gross, seller-net leg → seller.
  const { sellerNet } = computeUsdcSplit(BigInt(input.expectedGross));
  const subs = buyerRoot.subInvocations();
  if (subs.length === 0 || subs.length > 3) throw invalid('unexpected buyer usdc-leg count');
  let sum = 0n;
  let sawSellerNet = false;
  for (const sub of subs) {
    const sfn = sub.function();
    if (
      sfn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn() ||
      sub.subInvocations().length !== 0
    ) {
      throw invalid('malformed buyer usdc sub-invocation');
    }
    const t = sfn.contractFn();
    if (t.functionName().toString() !== 'transfer') throw invalid('buyer sub-invocation is not a transfer');
    if (Address.fromScAddress(t.contractAddress()).toString() !== input.usdcContract) {
      throw invalid('buyer transfer targets an unexpected token');
    }
    const ta = t.args();
    if (ta.length !== 3) throw invalid('unexpected transfer argument count');
    if ((scValToNative(ta[0]) as unknown) !== input.buyerWallet) throw invalid('buyer transfer `from` is not the buyer');
    if (ta[2].switch() !== xdr.ScValType.scvI128()) throw invalid('buyer transfer amount is not an i128');
    const amount = scValToBigInt(ta[2]);
    if (amount <= 0n) throw invalid('buyer transfer amount is non-positive');
    sum += amount;
    if ((scValToNative(ta[1]) as unknown) === input.sellerWallet) {
      if (amount !== sellerNet) throw invalid('seller-net leg amount does not match gross − fees');
      sawSellerNet = true;
    }
  }
  if (sum !== BigInt(input.expectedGross)) throw invalid('buyer usdc legs do not sum to gross');
  if (sellerNet > 0n && !sawSellerNet) throw invalid('missing the seller-net usdc leg');

  const buyerCreds = buyerEntry.credentials().address();
  const buyerSignatureCompact = verifyPasskeyOverRoot(input, input.networkPassphrase, buyerCreds, buyerRoot);

  return {
    tx,
    buyerAuthEntry: buyerEntry,
    buyerSignatureCompact,
    buyerSignatureExpirationLedger: buyerCreds.signatureExpirationLedger(),
    sellerSignatureExpirationLedger: sellerEntry.credentials().address().signatureExpirationLedger(),
  };
}

// ── The single-entry seller-authorize verifier (authorize/attach) ────────────────────────────────────────

/**
 * Verify the SELLER's signed, standalone `accept_quote` auth entry (TOV-177 authorize step) — the seller
 * signs their (root-only) entry ahead of any buyer. Pins the address to the recorded seller wallet, the
 * 5-tuple to server-trusted values, asserts NO sub-invocations, and verifies the seller's low-S WebAuthn
 * assertion. Returns the entry + the compact signature so the caller can attach the OZ AuthPayload.
 */
export interface VerifySellerQuoteAuthEntryInput extends PasskeyAssertion, AcceptTupleTrusted {
  sellerAuthEntryXdr: string;
  networkPassphrase: string;
  sellerWallet: string;
}

export interface VerifiedSellerQuoteAuthEntry {
  entry: xdr.SorobanAuthorizationEntry;
  signatureCompact: Buffer;
  signatureExpirationLedger: number;
}

export function verifySellerQuoteAuthEntry(input: VerifySellerQuoteAuthEntryInput): VerifiedSellerQuoteAuthEntry {
  let entry: xdr.SorobanAuthorizationEntry;
  try {
    entry = xdr.SorobanAuthorizationEntry.fromXDR(input.sellerAuthEntryXdr, 'base64');
  } catch {
    throw invalid('malformed seller auth entry');
  }
  const creds = assertEntryForWallet(entry, input.sellerWallet, 'seller');
  const root = assertAcceptRoot(entry, input, 'seller');
  if (root.subInvocations().length !== 0) throw invalid('seller auth tree must have no sub-invocations');
  const signatureCompact = verifyPasskeyOverRoot(input, input.networkPassphrase, creds, root);
  return { entry, signatureCompact, signatureExpirationLedger: creds.signatureExpirationLedger() };
}
