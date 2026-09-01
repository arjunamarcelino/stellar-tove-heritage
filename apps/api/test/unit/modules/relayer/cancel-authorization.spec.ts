import { describe, it, expect, beforeAll } from 'vitest';
import { StrKey, TransactionBuilder, Transaction, Networks } from '@stellar/stellar-sdk';
import { verifyCancelBidAuthorization } from '../../../../src/modules/relayer/cancel-authorization';
import { RelayerTransferError } from '../../../../src/modules/relayer/relayer.errors';
import { decodeCoseToRawP256 } from '../../../../src/modules/wallets/cose.helper';
import { FakeRelayerService } from '../../../shared/fake-relayer';
import { createSoftwarePasskey, signAssertion } from '../../../shared/webauthn-authenticator';

/**
 * MERGE-GATE unit guard for `verifyCancelBidAuthorization` (TOV-158) — the forked passkey verifier for the
 * ROOT-ONLY `cancel_bid` tree. Drives the REAL `FakeRelayerService.buildCancelBid` to emit an offline tx +
 * challenge, so verification runs end-to-end (challenge binding, u32-native bid_id exact-pin, caller/escrow
 * pins, the assert-no-sub-invocations rule, low-S secp256r1 against the bound key). Positive + negative + edge.
 */
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const NETWORK = Networks.TESTNET;
const contractId = (n: number) =>
  StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([n])]));
const CALLER = contractId(9);
const ESCROW = contractId(8);
const b64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

const BID_ID = 42;

describe('verifyCancelBidAuthorization', () => {
  const relayer = new FakeRelayerService();
  const passkey = createSoftwarePasskey();
  const boundKey = decodeCoseToRawP256(passkey.cosePublicKey);
  let txXdr: string;
  let challenge: string;

  beforeAll(async () => {
    const built = await relayer.buildCancelBid({ caller: CALLER, escrowContract: ESCROW, bidId: BID_ID });
    txXdr = built.txXdr;
    challenge = built.challenge;
  });

  const base = (assertion: { authenticatorData: string; clientDataJSON: string; signature: string }) => ({
    txXdr,
    networkPassphrase: NETWORK,
    expectedCaller: CALLER,
    escrowContract: ESCROW,
    contextRuleIds: [0],
    boundPublicKey: boundKey,
    authenticatorData: b64u(assertion.authenticatorData),
    clientDataJSON: b64u(assertion.clientDataJSON),
    signatureDer: b64u(assertion.signature),
    rpId: RP_ID,
    allowedOrigins: [ORIGIN],
    expectedBidId: BID_ID,
  });

  const sign = (ch: string, opts?: { origin?: string; flags?: number }) =>
    signAssertion({ passkey, challenge: ch, rpId: RP_ID, origin: opts?.origin ?? ORIGIN, flags: opts?.flags });

  // ── positive ────────────────────────────────────────────────────────────────────────────────────
  it('accepts a valid assertion over the root-only cancel_bid tree', () => {
    const result = verifyCancelBidAuthorization(base(sign(challenge)));
    expect(result.signatureCompact.length).toBe(64);
    expect(result.signatureExpirationLedger).toBeGreaterThan(0);
  });

  it('the built cancel_bid tx has exactly one op and zero sub-invocations (root-only)', () => {
    const tx = TransactionBuilder.fromXDR(txXdr, NETWORK) as Transaction;
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0];
    expect(op.type).toBe('invokeHostFunction');
    if (op.type === 'invokeHostFunction') {
      expect(op.auth?.[0]?.rootInvocation().subInvocations()).toHaveLength(0);
    }
  });

  // ── negative / edge ───────────────────────────────────────────────────────────────────────────────
  it('refuses a missing signature with signature_required', () => {
    const input = { ...base(sign(challenge)), signatureDer: new Uint8Array() };
    expect(() => verifyCancelBidAuthorization(input)).toThrow(
      expect.objectContaining({ reason: 'signature_required' }) as RelayerTransferError,
    );
  });

  it('refuses a signature from a different key', () => {
    const other = decodeCoseToRawP256(createSoftwarePasskey().cosePublicKey);
    expect(() => verifyCancelBidAuthorization({ ...base(sign(challenge)), boundPublicKey: other })).toThrow(
      /signature verification failed/,
    );
  });

  it('refuses a bid_id that does not match the server-trusted value (exact-pin)', () => {
    expect(() => verifyCancelBidAuthorization({ ...base(sign(challenge)), expectedBidId: 43 })).toThrow(
      /bid_id does not match/,
    );
  });

  it('refuses a caller that does not match the recorded bidder', () => {
    expect(() => verifyCancelBidAuthorization({ ...base(sign(challenge)), expectedCaller: contractId(5) })).toThrow(
      RelayerTransferError,
    );
  });

  it('refuses an unexpected escrow contract', () => {
    expect(() => verifyCancelBidAuthorization({ ...base(sign(challenge)), escrowContract: contractId(4) })).toThrow(
      RelayerTransferError,
    );
  });

  it('refuses a challenge that does not bind to this cancel', () => {
    expect(() => verifyCancelBidAuthorization(base(sign('not-the-real-challenge')))).toThrow(/challenge does not bind/);
  });

  it('refuses an off-allowlist origin', () => {
    expect(() => verifyCancelBidAuthorization(base(sign(challenge, { origin: 'https://evil.example' })))).toThrow(/origin/);
  });

  it('refuses when the user-verification flag is clear', () => {
    expect(() => verifyCancelBidAuthorization(base(sign(challenge, { flags: 0x01 })))).toThrow(/user-verification/);
  });
});
