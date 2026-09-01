import { describe, it, expect, beforeAll } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { verifyBidAuthorization } from '../../../../src/modules/relayer/bid-authorization';
import { RelayerTransferError } from '../../../../src/modules/relayer/relayer.errors';
import { decodeCoseToRawP256 } from '../../../../src/modules/wallets/cose.helper';
import { FakeRelayerService } from '../../../shared/fake-relayer';
import { createSoftwarePasskey, signAssertion } from '../../../shared/webauthn-authenticator';

/**
 * Unit guard for `verifyBidAuthorization` (TOV-156) — the forked passkey verifier for the nested
 * `submit_bid` tree. Drives the REAL `FakeRelayerService.buildBid` to emit an offline tx + challenge, so
 * verification runs end-to-end (challenge binding over the nested tree, exact price/count/inner-amount
 * pins, low-S secp256r1 against the bound key). Positive + negative + edge.
 */
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const contractId = (n: number) =>
  StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([n])]));
const WALLET = contractId(9);
const ESCROW = contractId(8);
const USDC = contractId(7);
const b64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

const PRICE = '100000000';
const COUNT = '10';
const MAX_COST = '1000000000000';
const IDEM = Buffer.alloc(32, 3);

describe('verifyBidAuthorization', () => {
  const relayer = new FakeRelayerService();
  const passkey = createSoftwarePasskey();
  const boundKey = decodeCoseToRawP256(passkey.cosePublicKey);
  let txXdr: string;
  let challenge: string;

  beforeAll(async () => {
    const built = await relayer.buildBid({
      walletContract: WALLET,
      escrowContract: ESCROW,
      tokenContract: USDC,
      priceScaled: PRICE,
      count: COUNT,
      idempotencyKey: IDEM,
    });
    txXdr = built.txXdr;
    challenge = built.challenge;
  });

  const base = (assertion: { authenticatorData: string; clientDataJSON: string; signature: string }) => ({
    txXdr,
    networkPassphrase: 'Test SDF Network ; September 2015',
    walletContract: WALLET,
    escrowContract: ESCROW,
    tokenContract: USDC,
    contextRuleIds: [0],
    boundPublicKey: boundKey,
    authenticatorData: b64u(assertion.authenticatorData),
    clientDataJSON: b64u(assertion.clientDataJSON),
    signatureDer: b64u(assertion.signature),
    rpId: RP_ID,
    allowedOrigins: [ORIGIN],
    expectedPriceScaled: PRICE,
    expectedCount: COUNT,
    maxCostScaled: MAX_COST,
    expectedIdemKey: IDEM,
  });

  const sign = (ch: string, opts?: { origin?: string; flags?: number }) =>
    signAssertion({ passkey, challenge: ch, rpId: RP_ID, origin: opts?.origin ?? ORIGIN, flags: opts?.flags });

  // ── positive ────────────────────────────────────────────────────────────────────────────────────
  it('accepts a valid assertion over the nested submit_bid tree', () => {
    const result = verifyBidAuthorization(base(sign(challenge)));
    expect(result.signatureCompact.length).toBe(64);
    expect(result.signatureExpirationLedger).toBeGreaterThan(0);
  });

  // ── negative / edge ───────────────────────────────────────────────────────────────────────────────
  it('refuses a missing signature with signature_required', () => {
    const input = { ...base(sign(challenge)), signatureDer: new Uint8Array() };
    expect(() => verifyBidAuthorization(input)).toThrow(
      expect.objectContaining({ reason: 'signature_required' }) as RelayerTransferError,
    );
  });

  it('refuses a signature from a different key', () => {
    const other = decodeCoseToRawP256(createSoftwarePasskey().cosePublicKey);
    expect(() => verifyBidAuthorization({ ...base(sign(challenge)), boundPublicKey: other })).toThrow(
      /signature verification failed/,
    );
  });

  it('refuses a price that does not match the server-trusted value (exact-pin, not <=cap)', () => {
    expect(() => verifyBidAuthorization({ ...base(sign(challenge)), expectedPriceScaled: '99999999' })).toThrow(
      /price does not match/,
    );
  });

  it('refuses a count that does not match the server-trusted value', () => {
    expect(() => verifyBidAuthorization({ ...base(sign(challenge)), expectedCount: '9' })).toThrow(
      /count does not match/,
    );
  });

  it('refuses when the escrow amount exceeds the ceiling', () => {
    // price*count = 1_000_000_000; a ceiling below that is refused even with a valid signature.
    expect(() => verifyBidAuthorization({ ...base(sign(challenge)), maxCostScaled: '1' })).toThrow(
      /exceeds the maximum/,
    );
  });

  it('refuses an idempotency_key that does not match the server-derived value (todo 297)', () => {
    expect(() => verifyBidAuthorization({ ...base(sign(challenge)), expectedIdemKey: Buffer.alloc(32, 9) })).toThrow(
      /idempotency_key does not match/,
    );
  });

  it('refuses an unexpected escrow contract', () => {
    expect(() => verifyBidAuthorization({ ...base(sign(challenge)), escrowContract: contractId(4) })).toThrow(
      RelayerTransferError,
    );
  });

  it('refuses a challenge that does not bind to this bid', () => {
    expect(() => verifyBidAuthorization(base(sign('not-the-real-challenge')))).toThrow(/challenge does not bind/);
  });

  it('refuses an off-allowlist origin', () => {
    expect(() => verifyBidAuthorization(base(sign(challenge, { origin: 'https://evil.example' })))).toThrow(/origin/);
  });

  it('refuses when the user-verification flag is clear', () => {
    expect(() => verifyBidAuthorization(base(sign(challenge, { flags: 0x01 })))).toThrow(/user-verification/);
  });
});
