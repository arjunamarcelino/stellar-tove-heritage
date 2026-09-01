import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { OfferingBidEscrowProcessor } from '@modules/offerings/bids/escrow/offering-bid-escrow.processor';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';

/**
 * Unit guard for the bid-escrow worker (TOV-156). Direct instantiation with vi.fn() deps (the sanctioned
 * `as never` processor pattern). Covers the failure branches the e2e (happy path) doesn't hit: the no-op
 * reload guard, retryable-rethrow, and terminal-fail latching.
 */
const makeJob = (attemptsMade = 0) =>
  ({
    attemptsMade,
    data: {
      bidId: 'bid-1',
      walletContract: 'W',
      escrowContract: 'E',
      tokenContract: 'T',
      priceScaled: '100',
      count: '10',
      maxCostScaled: '999999',
      idempotencyKey: Buffer.alloc(32, 5).toString('base64url'),
      txXdr: 'AAAA',
      boundPublicKey: Buffer.alloc(65, 4).toString('base64url'),
      credentialId: 'cred',
      authenticatorData: Buffer.alloc(37, 1).toString('base64url'),
      clientDataJSON: Buffer.from('{}').toString('base64url'),
      signature: Buffer.alloc(64, 2).toString('base64url'),
      rpId: 'tove.io',
      allowedOrigins: ['https://tove.io'],
    },
  }) as never;

describe('OfferingBidEscrowProcessor', () => {
  let bids: {
    findOneById: ReturnType<typeof vi.fn>;
    runInTransaction: ReturnType<typeof vi.fn>;
    casEscrowed: ReturnType<typeof vi.fn>;
    casFailed: ReturnType<typeof vi.fn>;
  };
  let relayer: { submitSignedBid: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let processor: OfferingBidEscrowProcessor;

  beforeEach(() => {
    bids = {
      findOneById: vi.fn().mockResolvedValue({ id: 'bid-1', status: 'submitted' }),
      runInTransaction: vi.fn(async (work: (m: unknown) => Promise<unknown>) => work({})),
      casEscrowed: vi.fn().mockResolvedValue(true),
      casFailed: vi.fn().mockResolvedValue(true),
    };
    relayer = { submitSignedBid: vi.fn() };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    processor = new OfferingBidEscrowProcessor(bids as never, relayer as never, audit as never);
  });

  it('latches escrowed + audits on a successful submit', async () => {
    relayer.submitSignedBid.mockResolvedValue({ txHash: 'A1B2', ledger: 42, bidId: 7 });
    await processor.process(makeJob());
    expect(bids.casEscrowed).toHaveBeenCalledWith(expect.anything(), 'bid-1', {
      chainBidId: 7,
      txHash: 'a1b2', // lowercased
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'offering.bid.escrowed' }),
      expect.anything(),
    );
    expect(bids.casFailed).not.toHaveBeenCalled();
  });

  it('is a no-op when the bid is not submitted (already latched / re-driven job)', async () => {
    bids.findOneById.mockResolvedValue({ id: 'bid-1', status: 'escrowed' });
    await processor.process(makeJob());
    expect(relayer.submitSignedBid).not.toHaveBeenCalled();
    expect(bids.casEscrowed).not.toHaveBeenCalled();
  });

  it('rethrows a retryable relayer error (unavailable), leaving the row submitted', async () => {
    relayer.submitSignedBid.mockRejectedValue(new RelayerTransferError('unavailable'));
    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(RelayerTransferError);
    expect(bids.casFailed).not.toHaveBeenCalled();
  });

  // ── money-safety (293): never casFailed a bid whose funds may have moved on-chain ──────────────────
  it('latches failed on a provably-no-funds-moved terminal error (signature_invalid)', async () => {
    relayer.submitSignedBid.mockRejectedValue(new RelayerTransferError('signature_invalid'));
    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(bids.casFailed).toHaveBeenCalledWith(expect.anything(), 'bid-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'offering.bid.escrow_failed' }),
      expect.anything(),
    );
  });

  it('latches failed on transfer_failed (applied-reverted → no funds moved)', async () => {
    relayer.submitSignedBid.mockRejectedValue(new RelayerTransferError('transfer_failed'));
    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(bids.casFailed).toHaveBeenCalledWith(expect.anything(), 'bid-1');
  });

  it('does NOT casFailed on a plain Error (RPC timeout after send is ambiguous) — rethrows, stays submitted', async () => {
    relayer.submitSignedBid.mockRejectedValue(new Error('rpc timeout'));
    await expect(processor.process(makeJob())).rejects.toThrow('rpc timeout');
    expect(bids.casFailed).not.toHaveBeenCalled();
  });

  it('casFailed on simulation_failed on the FIRST attempt (pre-send)', async () => {
    relayer.submitSignedBid.mockRejectedValue(new RelayerTransferError('simulation_failed'));
    await expect(processor.process(makeJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(bids.casFailed).toHaveBeenCalledWith(expect.anything(), 'bid-1');
  });

  it('does NOT casFailed on simulation_failed on a RETRY (could be on-chain DuplicateBid) — rethrows', async () => {
    relayer.submitSignedBid.mockRejectedValue(new RelayerTransferError('simulation_failed'));
    await expect(processor.process(makeJob(1))).rejects.toBeInstanceOf(RelayerTransferError);
    expect(bids.casFailed).not.toHaveBeenCalled();
  });
});
