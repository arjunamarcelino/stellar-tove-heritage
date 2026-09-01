import { describe, it, expect } from 'vitest';
import {
  StrKey, xdr, Address, Operation, TransactionBuilder, BASE_FEE, Networks, Account,
} from '@stellar/stellar-sdk';
import { verifyAcceptQuoteAuthorization } from '../../../../src/modules/relayer/accept-authorization';
import { RelayerTransferError } from '../../../../src/modules/relayer/relayer.errors';
import {
  buildAcceptQuoteOperation, buildBuyerRootInvocation, buildSellerRootInvocation,
  type AcceptQuoteArgs,
} from '../../../../src/modules/relayer/accept-quote-invocation';
import { computeHostPayloadHash, computeAuthDigest } from '../../../../src/modules/relayer/auth-entry-encoding';
import { decodeCoseToRawP256 } from '../../../../src/modules/wallets/cose.helper';
import { createSoftwarePasskey, signAssertion } from '../../../shared/webauthn-authenticator';

/**
 * Unit guard for `verifyAcceptQuoteAuthorization` (TOV-177) — the NET-NEW two-entry passkey verifier. Every
 * prior verifier asserts exactly ONE auth entry; accept_quote carries TWO (buyer + seller) and uses
 * `require_auth_for_args` (5-tuple roots ≠ the 7-arg op). A self-contained builder assembles the full
 * 2-entry tx so verification runs end-to-end offline. Positive + negative + edge.
 */
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const NET = Networks.TESTNET;
const FAKE_SOURCE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const EXP = 1_000_000;
const cid = (n: number) => StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([n])]));

const SETTLER = cid(1); const USDC = cid(2); const BUYER = cid(3); const SELLER = cid(4);
const TREASURY = cid(5); const ARTIST = cid(6);
const b64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

const passkey = createSoftwarePasskey();
const boundKey = decodeCoseToRawP256(passkey.cosePublicKey);
const args: AcceptQuoteArgs = {
  rfqId: new Uint8Array(32).fill(0x11), quoteId: new Uint8Array(32).fill(0x22), artworkId: new Uint8Array(32).fill(0x33),
  buyer: BUYER, seller: SELLER, count: 500n, gross: 10_000n,
};

function addrCreds(wallet: string, nonceSeed: number, credType: 'address' | 'source' = 'address'): xdr.SorobanCredentials {
  if (credType === 'source') return xdr.SorobanCredentials.sorobanCredentialsSourceAccount();
  return xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: Address.fromString(wallet).toScAddress(),
      nonce: xdr.Int64.fromString(String(nonceSeed)),
      signatureExpirationLedger: EXP,
      signature: xdr.ScVal.scvVoid(),
    }),
  );
}

interface TxOpts {
  buyerRoot?: xdr.SorobanAuthorizedInvocation;
  sellerRoot?: xdr.SorobanAuthorizedInvocation;
  entries?: 'both' | 'buyerOnly';
  sellerCred?: 'address' | 'source';
}

/** Assemble the full 2-entry accept_quote tx + the buyer challenge (over the buyer root). */
function buildAcceptTx(o: TxOpts = {}): { txXdr: string; challenge: string } {
  const buyerRoot = o.buyerRoot ?? buildBuyerRootInvocation({ settlerContract: SETTLER, usdcContract: USDC, treasury: TREASURY, artistPayout: ARTIST, args });
  const sellerRoot = o.sellerRoot ?? buildSellerRootInvocation(SETTLER, args);
  const buyerCreds = addrCreds(BUYER, 1);
  const buyerEntry = new xdr.SorobanAuthorizationEntry({ credentials: buyerCreds, rootInvocation: buyerRoot });
  const sellerEntry = new xdr.SorobanAuthorizationEntry({ credentials: addrCreds(SELLER, 2, o.sellerCred), rootInvocation: sellerRoot });
  const auth = o.entries === 'buyerOnly' ? [buyerEntry] : [buyerEntry, sellerEntry];
  const hostFunction = buildAcceptQuoteOperation(SETTLER, args).body().invokeHostFunctionOp().hostFunction();
  const op = Operation.invokeHostFunction({ func: hostFunction, auth });
  const tx = new TransactionBuilder(new Account(FAKE_SOURCE, '1'), { fee: BASE_FEE, networkPassphrase: NET })
    .addOperation(op).setTimeout(30).build();
  const challenge = computeAuthDigest(
    computeHostPayloadHash(NET, buyerCreds.address().nonce(), EXP, buyerRoot),
    [0],
  ).toString('base64url');
  return { txXdr: tx.toXDR(), challenge };
}

const base = (txXdr: string, a: { authenticatorData: string; clientDataJSON: string; signature: string }) => ({
  txXdr, networkPassphrase: NET, settlerContract: SETTLER, usdcContract: USDC,
  buyerWallet: BUYER, sellerWallet: SELLER,
  rfqId: args.rfqId, quoteId: args.quoteId, artworkId: args.artworkId, expectedCount: '500', expectedGross: '10000',
  contextRuleIds: [0], boundPublicKey: boundKey,
  authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signatureDer: b64u(a.signature),
  rpId: RP_ID, allowedOrigins: [ORIGIN],
});
const sign = (ch: string, opts?: { origin?: string; flags?: number }) =>
  signAssertion({ passkey, challenge: ch, rpId: RP_ID, origin: opts?.origin ?? ORIGIN, flags: opts?.flags });

describe('verifyAcceptQuoteAuthorization', () => {
  // ── positive ──────────────────────────────────────────────────────────────
  it('accepts a valid buyer assertion over the two-entry accept_quote tree', () => {
    const { txXdr, challenge } = buildAcceptTx();
    const r = verifyAcceptQuoteAuthorization(base(txXdr, sign(challenge)));
    expect(r.buyerSignatureCompact.length).toBe(64);
    expect(r.buyerSignatureExpirationLedger).toBe(EXP);
    expect(r.sellerSignatureExpirationLedger).toBe(EXP);
  });

  // ── negative / edge ─────────────────────────────────────────────────────────
  it('rejects a missing buyer signature with signature_required', () => {
    const { txXdr, challenge } = buildAcceptTx();
    expect(() => verifyAcceptQuoteAuthorization({ ...base(txXdr, sign(challenge)), signatureDer: new Uint8Array() }))
      .toThrow(expect.objectContaining({ reason: 'signature_required' }) as RelayerTransferError);
  });

  it('rejects a signature from a different key', () => {
    const { txXdr, challenge } = buildAcceptTx();
    const other = decodeCoseToRawP256(createSoftwarePasskey().cosePublicKey);
    expect(() => verifyAcceptQuoteAuthorization({ ...base(txXdr, sign(challenge)), boundPublicKey: other }))
      .toThrow(/signature verification failed/);
  });

  it('rejects a count that does not match the server-trusted value (exact-pin)', () => {
    const { txXdr, challenge } = buildAcceptTx();
    expect(() => verifyAcceptQuoteAuthorization({ ...base(txXdr, sign(challenge)), expectedCount: '499' }))
      .toThrow(/count does not match/);
  });

  it('rejects a gross that does not match the server-trusted value', () => {
    const { txXdr, challenge } = buildAcceptTx();
    expect(() => verifyAcceptQuoteAuthorization({ ...base(txXdr, sign(challenge)), expectedGross: '9999' }))
      .toThrow(/gross does not match|do not sum/);
  });

  it('rejects a wrong rfq_id (BytesN mismatch)', () => {
    const { txXdr, challenge } = buildAcceptTx();
    expect(() => verifyAcceptQuoteAuthorization({ ...base(txXdr, sign(challenge)), rfqId: new Uint8Array(32).fill(0x99) }))
      .toThrow(/rfq_id does not match/);
  });

  it('rejects when there is only one auth entry (missing the seller)', () => {
    const { txXdr, challenge } = buildAcceptTx({ entries: 'buyerOnly' });
    expect(() => verifyAcceptQuoteAuthorization(base(txXdr, sign(challenge)))).toThrow(/exactly two auth entries/);
  });

  it('rejects a SOURCE_ACCOUNT seller credential (confused-deputy)', () => {
    const { txXdr, challenge } = buildAcceptTx({ sellerCred: 'source' });
    expect(() => verifyAcceptQuoteAuthorization(base(txXdr, sign(challenge)))).toThrow(/seller address-credential/);
  });

  it('rejects a seller tree that carries sub-invocations (must be root-only)', () => {
    const sellerWithSubs = buildBuyerRootInvocation({ settlerContract: SETTLER, usdcContract: USDC, treasury: TREASURY, artistPayout: ARTIST, args });
    const { txXdr, challenge } = buildAcceptTx({ sellerRoot: sellerWithSubs });
    expect(() => verifyAcceptQuoteAuthorization(base(txXdr, sign(challenge)))).toThrow(/no sub-invocations/);
  });

  it('rejects a buyer subtree whose usdc legs do not sum to gross', () => {
    // A buyer root built for a DIFFERENT gross → legs sum to 5000, not the server-trusted 10000.
    const tampered = buildBuyerRootInvocation({
      settlerContract: SETTLER, usdcContract: USDC, treasury: TREASURY, artistPayout: ARTIST,
      args: { ...args, gross: 5000n },
    });
    const { txXdr, challenge } = buildAcceptTx({ buyerRoot: tampered });
    // The buyer root's 5-tuple gross (5000) also mismatches → caught as a root pin or a sum mismatch.
    expect(() => verifyAcceptQuoteAuthorization(base(txXdr, sign(challenge)))).toThrow(/gross does not match|do not sum/);
  });

  it('rejects a challenge that does not bind to this trade', () => {
    const { txXdr } = buildAcceptTx();
    expect(() => verifyAcceptQuoteAuthorization(base(txXdr, sign('not-the-real-challenge')))).toThrow(/challenge does not bind/);
  });

  it('rejects an off-allowlist origin', () => {
    const { txXdr, challenge } = buildAcceptTx();
    expect(() => verifyAcceptQuoteAuthorization(base(txXdr, sign(challenge, { origin: 'https://evil.example' })))).toThrow(/origin/);
  });

  it('rejects when the user-verification flag is clear', () => {
    const { txXdr, challenge } = buildAcceptTx();
    expect(() => verifyAcceptQuoteAuthorization(base(txXdr, sign(challenge, { flags: 0x01 })))).toThrow(/user-verification/);
  });
});
