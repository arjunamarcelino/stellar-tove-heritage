import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { OfferingBidsService } from '@modules/offerings/bids/offering-bids.service';
import { EmbeddedWalletNotFoundError } from '@modules/wallets/embedded-wallet-not-found.error';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { createSoftwarePasskey } from '../../../shared/webauthn-authenticator';

/**
 * Unit guard for the bid orchestration service (TOV-156, todo 301) — the idempotency ordering, gating, and
 * relayer-error mapping the e2e only partially covers. All deps mocked; no DB, no RPC.
 */
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const WALLET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const OFFERING_ID = '00000000-0000-4000-8000-0000000000ff';
const USER = '00000000-0000-4000-8000-0000000000aa';
const IDK = 'idem-key-1';

const cosePublicKey = createSoftwarePasskey().cosePublicKey; // a valid COSE key so decodeBoundKey succeeds

const openedOffering = () => ({
  status: 'opened',
  escrowContractAddress: WALLET,
  windowOpenAt: new Date(Date.now() - 60_000),
  windowCloseAt: new Date(Date.now() + 60_000),
  lowPriceStroops: '50000000',
  highPriceStroops: '150000000',
  publicFloat: '850000',
});

const walletResolution = () => ({
  contractAddress: WALLET,
  credential: { credentialId: 'cred', transports: 'internal', publicKey: cosePublicKey },
});

/** An escrowed bid owned by USER (the cancel entry point). */
const escrowedBid = () => ({
  id: 'bid-1',
  offeringId: OFFERING_ID,
  status: 'escrowed',
  chainBidId: 7,
  collectorWallet: WALLET,
  priceStroops: '100000000',
  count: '10',
  escrowAmountStroops: '1000000000',
  escrowTxHash: 'a'.repeat(64),
  refundTxHash: null,
  canceledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const cancelingBid = () => ({ ...escrowedBid(), status: 'canceling' });

function build() {
  const offerings = { findOneById: vi.fn().mockResolvedValue(openedOffering()) };
  // runInTransaction passes a manager whose getRepository().findOneOrFail returns the canceling row (the
  // cancel path re-reads the row inside the txn for the 202 body).
  const bids = {
    runInTransaction: vi.fn(async (w: (m: unknown) => Promise<unknown>) =>
      w({
        query: vi.fn().mockResolvedValue(undefined),
        getRepository: () => ({ findOneOrFail: vi.fn().mockResolvedValue(cancelingBid()) }),
      }),
    ),
    insertSubmitted: vi.fn(),
    findMyActiveBid: vi.fn().mockResolvedValue(null),
    findMyLatestBid: vi.fn().mockResolvedValue(null),
    casCanceling: vi.fn().mockResolvedValue(true),
    casCancelFailedBackToEscrowed: vi.fn().mockResolvedValue(true),
    countActiveForOffering: vi.fn().mockResolvedValue(0),
  };
  const users = { findKycStatusByUserId: vi.fn().mockResolvedValue({ kycStatus: KycStatus.WHITELISTED }) };
  const relayer = {
    buildBid: vi.fn().mockResolvedValue({ txXdr: 'AAAA', challenge: 'chal', expiresAtLedger: 999 }),
    submitSignedBid: vi.fn(),
    buildCancelBid: vi.fn().mockResolvedValue({ txXdr: 'BBBB', challenge: 'cchal', expiresAtLedger: 999 }),
    submitSignedCancelBid: vi.fn(),
    assertBidNotExpired: vi.fn().mockResolvedValue(undefined),
    readWalletHoldings: vi.fn().mockResolvedValue([{ tokenContract: USDC, amountScaled: '100000000000' }]),
  };
  const relayerCfg = { usdcTokenAddress: USDC } as never;
  const webauthn = { rpId: 'tove.io', origins: ['https://tove.io'] } as never;
  const cfg = { maxBidCostStroops: '1000000000000', maxBidsPerOffering: 40 } as never;
  const walletsService = { resolveEmbeddedWalletForUser: vi.fn().mockResolvedValue(walletResolution()) };
  const idempotency = {
    begin: vi.fn().mockResolvedValue({ outcome: 'proceed', token: 'tok' }),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const escrowQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const cancelQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const service = new OfferingBidsService(
    offerings as never,
    bids as never,
    users as never,
    relayer as never,
    relayerCfg,
    webauthn,
    cfg,
    walletsService as never,
    idempotency as never,
    audit as never,
    escrowQueue as never,
    cancelQueue as never,
  );
  return { service, offerings, bids, users, relayer, walletsService, idempotency, audit, escrowQueue, cancelQueue, cfg };
}

async function errorCode(p: Promise<unknown>): Promise<{ code?: string; status: number }> {
  try {
    await p;
  } catch (e) {
    const he = e as HttpException;
    const body = he.getResponse() as { errorCode?: string };
    return { code: body.errorCode, status: he.getStatus() };
  }
  throw new Error('expected the call to reject');
}

const prepareDto = { price: '100000000', count: 10 };
const submitDto = {
  price: '100000000',
  count: 10,
  txXdr: 'AAAA',
  authenticatorData: 'AA',
  clientDataJSON: 'AA',
  signature: 'AA',
};

describe('OfferingBidsService', () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => {
    t = build();
  });

  // ── prepare gating ───────────────────────────────────────────────────────────────────────────────
  it('prepare: unknown offering → 404 OFFERING_NOT_FOUND', async () => {
    t.offerings.findOneById.mockResolvedValue(null);
    expect(await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).toEqual({ code: 'OFFERING_NOT_FOUND', status: 404 });
  });

  it('prepare: not opened → 409 OFFERING_NOT_OPEN', async () => {
    t.offerings.findOneById.mockResolvedValue({ ...openedOffering(), status: 'planned' });
    expect((await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).code).toBe('OFFERING_NOT_OPEN');
  });

  it('prepare: window not open yet → 422 OFFERING_WINDOW_NOT_OPEN', async () => {
    t.offerings.findOneById.mockResolvedValue({ ...openedOffering(), windowOpenAt: new Date(Date.now() + 60_000) });
    expect((await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).code).toBe('OFFERING_WINDOW_NOT_OPEN');
  });

  it('prepare: window closed → 422 OFFERING_WINDOW_CLOSED', async () => {
    t.offerings.findOneById.mockResolvedValue({ ...openedOffering(), windowCloseAt: new Date(Date.now() - 1) });
    expect((await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).code).toBe('OFFERING_WINDOW_CLOSED');
  });

  it('prepare: below/above band → 422 BID_BELOW_LOW_PRICE / BID_ABOVE_HIGH_PRICE', async () => {
    expect((await errorCode(t.service.prepare(USER, OFFERING_ID, { price: '40000000', count: 10 }, IDK))).code).toBe('BID_BELOW_LOW_PRICE');
    expect((await errorCode(t.service.prepare(USER, OFFERING_ID, { price: '160000000', count: 10 }, IDK))).code).toBe('BID_ABOVE_HIGH_PRICE');
  });

  it('prepare: count > public_float → 422 BID_COUNT_EXCEEDS_FLOAT', async () => {
    t.offerings.findOneById.mockResolvedValue({ ...openedOffering(), publicFloat: '5' });
    expect((await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).code).toBe('BID_COUNT_EXCEEDS_FLOAT');
  });

  it('prepare: non-whitelisted → 403 BID_NOT_WHITELISTED', async () => {
    t.users.findKycStatusByUserId.mockResolvedValue({ kycStatus: KycStatus.PENDING_REVIEW });
    expect(await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).toEqual({ code: 'BID_NOT_WHITELISTED', status: 403 });
  });

  it('prepare: escrow cost above the per-bid ceiling → 422 BID_COST_EXCEEDS_LIMIT', async () => {
    t.cfg.maxBidCostStroops = '1';
    expect(await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).toEqual({ code: 'BID_COST_EXCEEDS_LIMIT', status: 422 });
  });

  it('prepare: no embedded wallet → 404 WALLET_NOT_FOUND', async () => {
    t.walletsService.resolveEmbeddedWalletForUser.mockRejectedValue(new EmbeddedWalletNotFoundError());
    expect(await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).toEqual({ code: 'WALLET_NOT_FOUND', status: 404 });
  });

  it('prepare: insufficient USDC balance → 422 BID_INSUFFICIENT_BALANCE with amounts', async () => {
    t.relayer.readWalletHoldings.mockResolvedValue([{ tokenContract: USDC, amountScaled: '100' }]);
    const res = await t.service.prepare(USER, OFFERING_ID, prepareDto, IDK).catch((e: HttpException) => e.getResponse());
    expect(res).toMatchObject({ errorCode: 'BID_INSUFFICIENT_BALANCE', requiredStroops: '1000000000', availableStroops: '100' });
  });

  it('prepare: balance read throws → 503 BID_UNAVAILABLE (fail-closed)', async () => {
    t.relayer.readWalletHoldings.mockRejectedValue(new RelayerTransferError('unavailable'));
    expect(await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).toEqual({ code: 'BID_UNAVAILABLE', status: 503 });
  });

  it('prepare: buildBid simulation_failed → 422 BID_ESCROW_REJECTED', async () => {
    t.relayer.buildBid.mockRejectedValue(new RelayerTransferError('simulation_failed'));
    expect(await errorCode(t.service.prepare(USER, OFFERING_ID, prepareDto, IDK))).toEqual({ code: 'BID_ESCROW_REJECTED', status: 422 });
  });

  it('prepare: happy path returns the escrow total + does NOT write a bid', async () => {
    const res = await t.service.prepare(USER, OFFERING_ID, prepareDto, IDK);
    expect(res.escrowAmountStroops).toBe('1000000000');
    expect(res.escrowContract).toBe(WALLET);
    expect(t.bids.insertSubmitted).not.toHaveBeenCalled();
  });

  // ── submit idempotency branches ──────────────────────────────────────────────────────────────────
  it('submit: replay returns the stored body', async () => {
    t.idempotency.begin.mockResolvedValue({ outcome: 'replay', body: { id: 'prior' } });
    expect(await t.service.submit(USER, OFFERING_ID, submitDto, IDK)).toEqual({ id: 'prior' });
  });

  it('submit: in_flight → 409 IDEMPOTENCY_KEY_IN_FLIGHT', async () => {
    t.idempotency.begin.mockResolvedValue({ outcome: 'in_flight' });
    expect(await errorCode(t.service.submit(USER, OFFERING_ID, submitDto, IDK))).toEqual({ code: 'IDEMPOTENCY_KEY_IN_FLIGHT', status: 409 });
  });

  it('submit: mismatch → 422 IDEMPOTENCY_KEY_MISMATCH', async () => {
    t.idempotency.begin.mockResolvedValue({ outcome: 'mismatch' });
    expect(await errorCode(t.service.submit(USER, OFFERING_ID, submitDto, IDK))).toEqual({ code: 'IDEMPOTENCY_KEY_MISMATCH', status: 422 });
  });

  it('submit: active-bid conflict → 409 BID_ALREADY_ACTIVE and fail() releases the key', async () => {
    t.bids.insertSubmitted.mockResolvedValue(null); // ON CONFLICT DO NOTHING
    expect((await errorCode(t.service.submit(USER, OFFERING_ID, submitDto, IDK))).code).toBe('BID_ALREADY_ACTIVE');
    expect(t.idempotency.fail).toHaveBeenCalledWith(expect.any(String), 'tok');
    expect(t.idempotency.complete).not.toHaveBeenCalled();
  });

  it('submit: malformed bound passkey key → 422 BID_SIGNATURE_INVALID', async () => {
    t.walletsService.resolveEmbeddedWalletForUser.mockResolvedValue({
      contractAddress: WALLET,
      credential: { credentialId: 'cred', transports: null, publicKey: Buffer.alloc(0) },
    });
    expect((await errorCode(t.service.submit(USER, OFFERING_ID, submitDto, IDK))).code).toBe('BID_SIGNATURE_INVALID');
  });

  it('submit: stale signature → BID_CHALLENGE_EXPIRED, no bid written, key released', async () => {
    t.relayer.assertBidNotExpired.mockRejectedValue(new RelayerTransferError('expired'));
    expect((await errorCode(t.service.submit(USER, OFFERING_ID, submitDto, IDK))).code).toBe('BID_CHALLENGE_EXPIRED');
    expect(t.bids.insertSubmitted).not.toHaveBeenCalled();
    expect(t.idempotency.fail).toHaveBeenCalled();
  });

  it('submit: happy path records the bid, completes idempotency, and enqueues', async () => {
    t.bids.insertSubmitted.mockResolvedValue({
      id: 'bid-1',
      offeringId: OFFERING_ID,
      priceStroops: '100000000',
      count: '10',
      escrowAmountStroops: '1000000000',
      status: 'submitted',
      chainBidId: null,
      escrowTxHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const body = await t.service.submit(USER, OFFERING_ID, submitDto, IDK);
    expect(body.status).toBe('submitted');
    expect(t.idempotency.complete).toHaveBeenCalledWith(expect.any(String), 'tok', body);
    expect(t.escrowQueue.add).toHaveBeenCalled();
    expect(t.idempotency.fail).not.toHaveBeenCalled();
  });

  // ── TOV-158 cancel: getMyBid uses findMyLatestBid (surfaces terminal states) ────────────────────────
  it('getMyBid reads the latest bid (incl. terminal canceled)', async () => {
    t.bids.findMyLatestBid.mockResolvedValue({ ...cancelingBid(), status: 'canceled', refundTxHash: 'b'.repeat(64), canceledAt: new Date() });
    const res = await t.service.getMyBid(USER, OFFERING_ID);
    expect(res?.status).toBe('canceled');
    expect(res?.refundTxHash).toBe('b'.repeat(64));
    expect(t.bids.findMyActiveBid).not.toHaveBeenCalled();
  });

  // ── cancel/prepare gating ──────────────────────────────────────────────────────────────────────────
  it('prepareCancel: no active bid → 404 BID_NOT_FOUND', async () => {
    t.bids.findMyActiveBid.mockResolvedValue(null);
    expect(await errorCode(t.service.prepareCancel(USER, OFFERING_ID))).toEqual({ code: 'BID_NOT_FOUND', status: 404 });
  });

  it('prepareCancel: offering not opened → 409 OFFERING_NOT_OPEN', async () => {
    t.offerings.findOneById.mockResolvedValue({ ...openedOffering(), status: 'subscribed' });
    expect((await errorCode(t.service.prepareCancel(USER, OFFERING_ID))).code).toBe('OFFERING_NOT_OPEN');
  });

  it('prepareCancel: an in-flight submitted bid (no chain id) → 409 BID_NOT_CANCELABLE', async () => {
    t.bids.findMyActiveBid.mockResolvedValue({ ...escrowedBid(), status: 'submitted', chainBidId: null });
    expect((await errorCode(t.service.prepareCancel(USER, OFFERING_ID))).code).toBe('BID_NOT_CANCELABLE');
  });

  it('prepareCancel: happy path pins caller=collector_wallet + returns the on-chain bid id', async () => {
    t.bids.findMyActiveBid.mockResolvedValue(escrowedBid());
    const res = await t.service.prepareCancel(USER, OFFERING_ID);
    expect(res.bidId).toBe(7);
    expect(res.escrowContract).toBe(WALLET);
    expect(t.relayer.buildCancelBid).toHaveBeenCalledWith({ caller: WALLET, escrowContract: WALLET, bidId: 7 });
  });

  it('prepareCancel is NOT whitelist-gated (a de-whitelisted owner can still prepare)', async () => {
    t.bids.findMyActiveBid.mockResolvedValue(escrowedBid());
    t.users.findKycStatusByUserId.mockResolvedValue({ kycStatus: KycStatus.FROZEN });
    const res = await t.service.prepareCancel(USER, OFFERING_ID);
    expect(res.bidId).toBe(7);
    expect(t.users.findKycStatusByUserId).not.toHaveBeenCalled(); // no KYC read on the cancel path at all
  });

  // ── cancel submit ──────────────────────────────────────────────────────────────────────────────────
  const cancelDto = { txXdr: 'BBBB', authenticatorData: 'AA', clientDataJSON: 'AA', signature: 'AA' };

  it('cancel: replay returns the stored body', async () => {
    t.idempotency.begin.mockResolvedValue({ outcome: 'replay', body: { id: 'prior', status: 'canceling' } });
    expect(await t.service.cancel(USER, OFFERING_ID, cancelDto, IDK)).toEqual({ id: 'prior', status: 'canceling' });
  });

  it('cancel: CAS lost (concurrent cancel) → 409 BID_NOT_CANCELABLE and fail() releases the key', async () => {
    t.bids.findMyActiveBid.mockResolvedValue(escrowedBid());
    t.bids.casCanceling.mockResolvedValue(false);
    expect((await errorCode(t.service.cancel(USER, OFFERING_ID, cancelDto, IDK))).code).toBe('BID_NOT_CANCELABLE');
    expect(t.idempotency.fail).toHaveBeenCalledWith(expect.any(String), 'tok');
    expect(t.idempotency.complete).not.toHaveBeenCalled();
  });

  it('cancel: stale signature → BID_CHALLENGE_EXPIRED, no CAS, key released', async () => {
    t.bids.findMyActiveBid.mockResolvedValue(escrowedBid());
    t.relayer.assertBidNotExpired.mockRejectedValue(new RelayerTransferError('expired'));
    expect((await errorCode(t.service.cancel(USER, OFFERING_ID, cancelDto, IDK))).code).toBe('BID_CHALLENGE_EXPIRED');
    expect(t.bids.casCanceling).not.toHaveBeenCalled();
    expect(t.idempotency.fail).toHaveBeenCalled();
  });

  it('cancel: happy path CAS canceling, audits, enqueues, completes → 202 canceling body', async () => {
    t.bids.findMyActiveBid.mockResolvedValue(escrowedBid());
    const body = await t.service.cancel(USER, OFFERING_ID, cancelDto, IDK);
    expect(body.status).toBe('canceling');
    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'offering.bid.canceling' }), expect.anything());
    expect(t.cancelQueue.add).toHaveBeenCalled();
    expect(t.idempotency.complete).toHaveBeenCalledWith(expect.any(String), 'tok', body);
    expect(t.idempotency.fail).not.toHaveBeenCalled();
  });

  it('cancel: enqueue failure compensates (revert to escrowed) + fail() + 503', async () => {
    t.bids.findMyActiveBid.mockResolvedValue(escrowedBid());
    t.cancelQueue.add.mockRejectedValue(new Error('redis down'));
    expect((await errorCode(t.service.cancel(USER, OFFERING_ID, cancelDto, IDK))).status).toBe(503);
    expect(t.bids.casCancelFailedBackToEscrowed).toHaveBeenCalled();
    expect(t.idempotency.fail).toHaveBeenCalledWith(expect.any(String), 'tok');
    expect(t.idempotency.complete).not.toHaveBeenCalled();
  });

  it('cancel: a post-enqueue complete() failure does NOT revert (job is live) — returns 202, no double-refund', async () => {
    t.bids.findMyActiveBid.mockResolvedValue(escrowedBid());
    // add() succeeds (job is live); complete() then blips.
    t.idempotency.complete.mockRejectedValue(new Error('redis blip'));
    const body = await t.service.cancel(USER, OFFERING_ID, cancelDto, IDK);
    expect(body.status).toBe('canceling'); // resolves 202, does not throw
    expect(t.cancelQueue.add).toHaveBeenCalled();
    // Critical: the live job must NOT be reverted, and the key must NOT be failed.
    expect(t.bids.casCancelFailedBackToEscrowed).not.toHaveBeenCalled();
    expect(t.idempotency.fail).not.toHaveBeenCalled();
  });
});
