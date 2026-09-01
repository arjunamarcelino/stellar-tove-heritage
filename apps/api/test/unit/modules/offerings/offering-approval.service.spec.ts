import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { BackofficeOfferingsService } from '../../../../src/modules/backoffice/offerings/backoffice-offerings.service';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { ACTIVE_OFFERING_STATUSES } from '../../../../src/modules/offerings/constants/offering-status.constant';

const SIGNER_A = '00000000-0000-4000-8000-00000000ad01';
const SIGNER_B = '00000000-0000-4000-8000-00000000ad02';
const OUTSIDER = '00000000-0000-4000-8000-00000000ad99';
const ARTWORK = '00000000-0000-4000-8000-0000000a0001';
const OFFERING_ID = 'off1';
const KEY = 'idem-approve-1';
const ARTIST_ADDR = 'GARTIST00000000000000000000000000000000000000000000000000';

/** errorCode carried on the object-form HttpException body (failHttp). */
const errorCodeOf = (err: unknown): string | undefined =>
  err instanceof HttpException ? (err.getResponse() as { errorCode?: string }).errorCode : undefined;

/** Await a promise expecting rejection; returns the thrown error (fails loudly if it resolves). */
async function catchErr(p: Promise<unknown>): Promise<HttpException> {
  let thrown: unknown;
  try {
    await p;
  } catch (e) {
    thrown = e;
  }
  if (!thrown) throw new Error('expected promise to reject but it resolved');
  return thrown as HttpException;
}

/** A `planned` offering with no snapshot / no escrow deploy yet. */
const baseOffering = () => ({
  id: OFFERING_ID,
  artworkId: ARTWORK,
  status: 'planned',
  escrowDeployStatus: null as string | null,
  escrowContractAddress: null as string | null,
  fractionContractId: 'fc1',
  snapshotArtistAddress: null as string | null,
  lowPriceStroops: '50000000',
  highPriceStroops: '150000000',
  publicFloat: '850000',
  windowOpenAt: new Date('2026-09-01T00:00:00Z'),
  windowCloseAt: new Date('2026-09-08T00:00:00Z'),
});

function build(
  o: {
    offering?: Partial<ReturnType<typeof baseOffering>>;
    txnOffering?: object | null;
    readOffering?: object | null;
    begin?: unknown;
    count?: number;
    casEscrowDeploying?: boolean;
    threshold?: number;
    contract?: object | null;
    summaries?: Map<string, { count: number; youApproved: boolean }>;
    listResult?: [object[], number];
  } = {},
) {
  const offering = { ...baseOffering(), ...(o.offering ?? {}) };

  const txnRepo = {
    findOne: vi.fn(() => Promise.resolve('txnOffering' in o ? o.txnOffering : offering)),
  };
  const manager = { getRepository: vi.fn(() => txnRepo) };

  const offerings = {
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
    findOneById: vi.fn(() => Promise.resolve('readOffering' in o ? o.readOffering : offering)),
    setSnapshotArtistAddress: vi.fn(() => Promise.resolve(undefined)),
    casEscrowDeploying: vi.fn(() => Promise.resolve(o.casEscrowDeploying ?? true)),
    listForBackoffice: vi.fn(() => Promise.resolve(o.listResult ?? [[], 0])),
  };
  const approvals = {
    insertSignature: vi.fn(() => Promise.resolve(undefined)),
    countLiveSigners: vi.fn(() => Promise.resolve(o.count ?? 1)),
    approvalSummariesFor: vi.fn(() => Promise.resolve(o.summaries ?? new Map())),
  };
  const artworks = { findOneById: vi.fn() };
  const contracts = {
    findOneById: vi.fn(() =>
      Promise.resolve('contract' in o ? o.contract : { id: 'fc1', artistAddress: ARTIST_ADDR }),
    ),
  };
  const escrowCfg = {
    signerSet: new Set<string>([SIGNER_A, SIGNER_B]),
    threshold: o.threshold ?? 2,
    maxBidsPerOffering: 40,
  };
  const deployQueue = { add: vi.fn(() => Promise.resolve(undefined)) };
  const settleQueue = { add: vi.fn(() => Promise.resolve(undefined)) };
  const bids = {
    listBidsForClearing: vi.fn(() => Promise.resolve([])),
    countInflight: vi.fn(() => Promise.resolve(0)),
    sumEscrowedCount: vi.fn(() => Promise.resolve('0')),
    countActiveForOffering: vi.fn(() => Promise.resolve(0)),
  };
  const idempotency = {
    begin: vi.fn(() => Promise.resolve(o.begin ?? { outcome: 'proceed', token: 't1' })),
    complete: vi.fn(() => Promise.resolve(undefined)),
    fail: vi.fn(() => Promise.resolve(undefined)),
  };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };

  const service = new BackofficeOfferingsService(
    offerings as never,
    approvals as never,
    artworks as never,
    contracts as never,
    escrowCfg as never,
    deployQueue as never,
    idempotency as never,
    audit as never,
  );
  return { service, offerings, approvals, bids, artworks, contracts, escrowCfg, deployQueue, settleQueue, idempotency, audit, txnRepo, manager };
}

const approve = (h: ReturnType<typeof build>, sub: string = SIGNER_A, key: string = KEY) =>
  h.service.approve(OFFERING_ID, sub, key);

describe('BackofficeOfferingsService.approve', () => {
  beforeEach(() => vi.clearAllMocks());

  // --- U1 first authorized signer (below quorum) --------------------------
  it('U1 first signer approves (count 1 < threshold 2): no CAS, no enqueue, snapshots artist, completes', async () => {
    const h = build({ count: 1 });
    const res = await approve(h);

    expect(res.approvals.count).toBe(1);
    expect(res.approvals.threshold).toBe(2);
    expect(res.escrow.deployStatus).toBeNull();
    expect(h.offerings.casEscrowDeploying).not.toHaveBeenCalled();
    expect(h.deployQueue.add).not.toHaveBeenCalled();
    expect(h.offerings.setSnapshotArtistAddress).toHaveBeenCalledWith(h.manager, OFFERING_ID, ARTIST_ADDR);
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  // --- U2 quorum reached + CAS won → enqueue once -------------------------
  it('U2 second distinct signer reaches quorum + CAS won → deployQueue.add once (jobId, attempts 5)', async () => {
    const h = build({ count: 2, casEscrowDeploying: true });
    await approve(h, SIGNER_B);

    expect(h.offerings.casEscrowDeploying).toHaveBeenCalledOnce();
    expect(h.deployQueue.add).toHaveBeenCalledOnce();
    const [name, payload, opts] = h.deployQueue.add.mock.calls[0] as [string, object, { jobId: string; attempts: number }];
    expect(name).toBe('deploy');
    expect(payload).toEqual({ offeringId: OFFERING_ID });
    expect(opts.jobId).toMatch(/^deploy:.*:/);
    expect(opts.attempts).toBe(5);
  });

  // --- U2b quorum reached but CAS lost ------------------------------------
  it('U2b quorum reached but casEscrowDeploying false (lost race) → no enqueue', async () => {
    const h = build({ count: 2, casEscrowDeploying: false });
    await approve(h, SIGNER_B);

    expect(h.offerings.casEscrowDeploying).toHaveBeenCalledOnce();
    expect(h.deployQueue.add).not.toHaveBeenCalled();
  });

  // --- U3 idempotent re-sign ---------------------------------------------
  it('U3 same admin re-approve: insertSignature still runs (idempotent), completes', async () => {
    const h = build({ count: 1 });
    await approve(h);
    expect(h.approvals.insertSignature).toHaveBeenCalledWith(h.manager, OFFERING_ID, SIGNER_A);
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
  });

  // --- U4 not a signer ----------------------------------------------------
  it('U4 caller not in signerSet → 403 OFFERING_APPROVAL_NOT_A_SIGNER, begin never called', async () => {
    const h = build();
    const err = await catchErr(approve(h, OUTSIDER));
    expect(err.getStatus()).toBe(403);
    expect(errorCodeOf(err)).toBe(ErrorCode.OFFERING_APPROVAL_NOT_A_SIGNER);
    expect(h.idempotency.begin).not.toHaveBeenCalled();
  });

  // --- U5 not planned -----------------------------------------------------
  it('U5 offering.status !== planned → 409 OFFERING_NOT_PLANNED, idempotency.fail called', async () => {
    const h = build({ offering: { status: 'approved' } });
    const err = await catchErr(approve(h));
    expect(err.getStatus()).toBe(409);
    expect(errorCodeOf(err)).toBe(ErrorCode.OFFERING_NOT_PLANNED);
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  // --- U6 offering not found ---------------------------------------------
  it('U6 offering not found (txn findOne → null) → 404 OFFERING_NOT_FOUND, idempotency.fail called', async () => {
    const h = build({ txnOffering: null });
    const err = await catchErr(approve(h));
    expect(err.getStatus()).toBe(404);
    expect(errorCodeOf(err)).toBe(ErrorCode.OFFERING_NOT_FOUND);
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  // --- U7 replay ----------------------------------------------------------
  it('U7 begin replay → returns stored body, no transaction', async () => {
    const stored = { offeringId: OFFERING_ID, status: 'planned', approvals: { count: 1 } };
    const h = build({ begin: { outcome: 'replay', body: stored } });
    await expect(approve(h)).resolves.toEqual(stored);
    expect(h.offerings.runInTransaction).not.toHaveBeenCalled();
  });

  // --- U7b in_flight / mismatch ------------------------------------------
  it('U7b begin in_flight → 409 IDEMPOTENCY_KEY_IN_FLIGHT', async () => {
    const h = build({ begin: { outcome: 'in_flight' } });
    const err = await catchErr(approve(h));
    expect(err.getStatus()).toBe(409);
    expect(errorCodeOf(err)).toBe(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT);
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  it('U7b begin mismatch → 422 IDEMPOTENCY_KEY_MISMATCH', async () => {
    const h = build({ begin: { outcome: 'mismatch' } });
    const err = await catchErr(approve(h));
    expect(err.getStatus()).toBe(422);
    expect(errorCodeOf(err)).toBe(ErrorCode.IDEMPOTENCY_KEY_MISMATCH);
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  // --- U8 escrow deploy state gating -------------------------------------
  it('U8 escrowDeployStatus "deploying" → 409 OFFERING_APPROVAL_IN_PROGRESS', async () => {
    const h = build({ offering: { escrowDeployStatus: 'deploying' } });
    const err = await catchErr(approve(h));
    expect(err.getStatus()).toBe(409);
    expect(errorCodeOf(err)).toBe(ErrorCode.OFFERING_APPROVAL_IN_PROGRESS);
    expect(h.approvals.insertSignature).not.toHaveBeenCalled();
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it('U8 escrowDeployStatus "failed" → falls through, proceeds to insertSignature', async () => {
    const h = build({ offering: { escrowDeployStatus: 'failed' }, count: 1 });
    await approve(h);
    expect(h.approvals.insertSignature).toHaveBeenCalledWith(h.manager, OFFERING_ID, SIGNER_A);
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
  });

  // --- U8b no re-snapshot when already set --------------------------------
  it('U8b snapshotArtistAddress already set → setSnapshotArtistAddress NOT called (no re-snapshot)', async () => {
    const h = build({ offering: { snapshotArtistAddress: ARTIST_ADDR }, count: 1 });
    await approve(h);
    expect(h.contracts.findOneById).not.toHaveBeenCalled();
    expect(h.offerings.setSnapshotArtistAddress).not.toHaveBeenCalled();
  });

  // --- U9 higher threshold, not yet quorum --------------------------------
  it('U9 threshold 3, count 2 → not quorum: no CAS, no enqueue', async () => {
    const h = build({ threshold: 3, count: 2 });
    await approve(h, SIGNER_B);
    expect(h.offerings.casEscrowDeploying).not.toHaveBeenCalled();
    expect(h.deployQueue.add).not.toHaveBeenCalled();
  });
});

describe('BackofficeOfferingsService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  const row = (id: string) => ({ ...baseOffering(), id });

  // --- U24 mapping via approvalSummariesFor -------------------------------
  it('U24 maps rows via approvalSummariesFor into items with count/threshold/youApproved + meta', async () => {
    const rows = [row('o1'), row('o2')];
    const summaries = new Map([
      ['o1', { count: 1, youApproved: true }],
      ['o2', { count: 0, youApproved: false }],
    ]);
    const h = build({ listResult: [rows, 2], summaries });
    const res = await h.service.list({ page: 1, limit: 10 }, SIGNER_A);

    expect(res.data).toHaveLength(2);
    expect(res.data[0].approvals).toEqual({ count: 1, threshold: 2, youApproved: true });
    expect(res.data[1].approvals).toEqual({ count: 0, threshold: 2, youApproved: false });
    expect(res.meta).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(h.approvals.approvalSummariesFor).toHaveBeenCalledWith(['o1', 'o2'], h.escrowCfg.signerSet, SIGNER_A);
  });

  // --- U25 default statuses -----------------------------------------------
  it('U25 parseStatuses(undefined) → ACTIVE_OFFERING_STATUSES passed to listForBackoffice', async () => {
    const h = build({ listResult: [[], 0] });
    await h.service.list({ page: 1, limit: 10 }, SIGNER_A);
    const arg = h.offerings.listForBackoffice.mock.calls[0][0] as { statuses: readonly string[] };
    expect(arg.statuses).toEqual(ACTIVE_OFFERING_STATUSES);
  });

  // --- U25b invalid csv ---------------------------------------------------
  it('U25b invalid status csv → 400 VALIDATION_FAILED', async () => {
    const h = build();
    const err = await catchErr(h.service.list({ page: 1, limit: 10, status: 'planned,bogus' }, SIGNER_A));
    expect(err.getStatus()).toBe(400);
    expect(errorCodeOf(err)).toBe(ErrorCode.VALIDATION_FAILED);
  });

  // --- U26 empty rows -----------------------------------------------------
  it('U26 empty rows → approvalSummariesFor NOT called, empty data', async () => {
    const h = build({ listResult: [[], 0] });
    const res = await h.service.list({ page: 1, limit: 10 }, SIGNER_A);
    expect(res.data).toEqual([]);
    expect(h.approvals.approvalSummariesFor).not.toHaveBeenCalled();
  });
});

describe('BackofficeOfferingsService.getOne', () => {
  beforeEach(() => vi.clearAllMocks());

  // --- U27 not found ------------------------------------------------------
  it('U27 offering not found → 404 OFFERING_NOT_FOUND', async () => {
    const h = build({ readOffering: null });
    const err = await catchErr(h.service.getOne(OFFERING_ID, SIGNER_A));
    expect(err.getStatus()).toBe(404);
    expect(errorCodeOf(err)).toBe(ErrorCode.OFFERING_NOT_FOUND);
  });

  // --- U28 detail body ----------------------------------------------------
  it('U28 found → OfferingDetailDto with aggregate approvals (no raw signers) + attestedArtistAddress', async () => {
    const summaries = new Map([[OFFERING_ID, { count: 1, youApproved: true }]]);
    const h = build({
      offering: { snapshotArtistAddress: ARTIST_ADDR },
      summaries,
    });
    const res = await h.service.getOne(OFFERING_ID, SIGNER_A);

    expect(res.id).toBe(OFFERING_ID);
    expect(res.attestedArtistAddress).toBe(ARTIST_ADDR);
    // Anti-collusion (TOV-155): aggregate only, no raw approver identities.
    expect(res.approvals).toEqual({ count: 1, threshold: 2, youApproved: true });
    expect(res.approvals).not.toHaveProperty('signers');
  });
});
