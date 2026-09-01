import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { OfferingBidCancelProcessor } from '@modules/offerings/bids/cancel/offering-bid-cancel.processor';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';

/**
 * Unit guard for the bid-CANCEL/refund worker (TOV-158) — the INVERTED money-safety classifier. Direct
 * instantiation with vi.fn() deps. The crux: on a provably-no-refund failure the worker reverts
 * `canceling → escrowed` (funds still held); on ANY ambiguity it rethrows and the row STAYS `canceling`
 * (never re-cancelable → no double refund). Poll-timeout (`unavailable`) is the merge-gate case.
 */
const makeJob = (attemptsMade = 0) =>
  ({
    attemptsMade,
    data: {
      bidId: 'bid-1',
      walletContract: 'W',
      escrowContract: 'E',
      chainBidId: 42,
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

describe('OfferingBidCancelProcessor', () => {
  let bids: {
    findOneById: ReturnType<typeof vi.fn>;
    runInTransaction: ReturnType<typeof vi.fn>;
    casCanceled: ReturnType<typeof vi.fn>;
    casCancelFailedBackToEscrowed: ReturnType<typeof vi.fn>;
  };
  let relayer: { submitSignedCancelBid: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let processor: OfferingBidCancelProcessor;

  beforeEach(() => {
    bids = {
      findOneById: vi.fn().mockResolvedValue({ id: 'bid-1', status: 'canceling' }),
      runInTransaction: vi.fn(async (work: (m: unknown) => Promise<unknown>) => work({})),
      casCanceled: vi.fn().mockResolvedValue(true),
      casCancelFailedBackToEscrowed: vi.fn().mockResolvedValue(true),
    };
    relayer = { submitSignedCancelBid: vi.fn() };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    processor = new OfferingBidCancelProcessor(bids as never, relayer as never, audit as never);
  });

  it('latches canceled + stamps refund hash + audits on a successful refund', async () => {
    relayer.submitSignedCancelBid.mockResolvedValue({ txHash: 'A1B2', ledger: 42, status: 'SUCCESS' });
    await processor.process(makeJob());
    expect(bids.casCanceled).toHaveBeenCalledWith(expect.anything(), 'bid-1', { refundTxHash: 'a1b2' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'offering.bid.canceled' }),
      expect.anything(),
    );
    expect(bids.casCancelFailedBackToEscrowed).not.toHaveBeenCalled();
  });

  it('is a no-op when the bid is not canceling (already resolved / re-driven job)', async () => {
    bids.findOneById.mockResolvedValue({ id: 'bid-1', status: 'escrowed' });
    await processor.process(makeJob());
    expect(relayer.submitSignedCancelBid).not.toHaveBeenCalled();
    expect(bids.casCanceled).not.toHaveBeenCalled();
  });

  // ── merge-gate: poll-timeout must NOT revert (ambiguous → stays canceling) ──────────────────────────
  it('rethrows on unavailable (poll-timeout ambiguity), leaving the row canceling — no revert', async () => {
    relayer.submitSignedCancelBid.mockRejectedValue(new RelayerTransferError('unavailable'));
    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(RelayerTransferError);
    expect(bids.casCancelFailedBackToEscrowed).not.toHaveBeenCalled();
    expect(bids.casCanceled).not.toHaveBeenCalled();
  });

  it('does NOT revert on a plain Error (RPC timeout after send is ambiguous) — rethrows, stays canceling', async () => {
    relayer.submitSignedCancelBid.mockRejectedValue(new Error('rpc timeout'));
    await expect(processor.process(makeJob())).rejects.toThrow('rpc timeout');
    expect(bids.casCancelFailedBackToEscrowed).not.toHaveBeenCalled();
  });

  // ── provably-no-refund → revert canceling → escrowed (slot held) ────────────────────────────────────
  it('reverts to escrowed on signature_invalid (pre-send → no refund moved)', async () => {
    relayer.submitSignedCancelBid.mockRejectedValue(new RelayerTransferError('signature_invalid'));
    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(bids.casCancelFailedBackToEscrowed).toHaveBeenCalledWith(expect.anything(), 'bid-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'offering.bid.cancel_failed' }),
      expect.anything(),
    );
  });

  it('reverts to escrowed on transfer_failed (applied-reverted, e.g. NotOpen → no refund moved)', async () => {
    relayer.submitSignedCancelBid.mockRejectedValue(new RelayerTransferError('transfer_failed'));
    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(bids.casCancelFailedBackToEscrowed).toHaveBeenCalledWith(expect.anything(), 'bid-1');
  });

  it('self-heals to escrowed on expired (a persistently-ambiguous cancel eventually expires)', async () => {
    relayer.submitSignedCancelBid.mockRejectedValue(new RelayerTransferError('expired'));
    await expect(processor.process(makeJob(3))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(bids.casCancelFailedBackToEscrowed).toHaveBeenCalledWith(expect.anything(), 'bid-1');
  });

  it('reverts on simulation_failed on the FIRST attempt (pre-send re-simulation)', async () => {
    relayer.submitSignedCancelBid.mockRejectedValue(new RelayerTransferError('simulation_failed'));
    await expect(processor.process(makeJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(bids.casCancelFailedBackToEscrowed).toHaveBeenCalledWith(expect.anything(), 'bid-1');
  });

  it('does NOT revert on simulation_failed on a RETRY (could be a landed refund surfacing) — rethrows', async () => {
    relayer.submitSignedCancelBid.mockRejectedValue(new RelayerTransferError('simulation_failed'));
    await expect(processor.process(makeJob(1))).rejects.toBeInstanceOf(RelayerTransferError);
    expect(bids.casCancelFailedBackToEscrowed).not.toHaveBeenCalled();
  });
});
