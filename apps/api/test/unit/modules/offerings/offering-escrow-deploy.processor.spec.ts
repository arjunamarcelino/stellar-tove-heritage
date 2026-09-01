import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { OfferingEscrowDeployProcessor } from '../../../../src/modules/offerings/deploy/offering-escrow-deploy.processor';
import { AUDIT_KIND } from '../../../../src/modules/wallets/audit/audit-log.types';
import {
  OfferingEscrowError,
  OfferingEscrowThrottledError,
} from '../../../../src/modules/offerings/escrow/offering-escrow.errors';

/**
 * Unit specs for the OfferingEscrow deploy worker (TOV-154, WS7). Pure mocks — the port, the three
 * repos, cfg and audit are all stubbed; `mapConstructorArgs` / `assertPublicFloatMatches` run for real.
 * Constructor injection order (see the processor): offerings, approvals, fractionContracts, escrow, cfg,
 * audit. Job is `{ data: { offeringId } }`.
 */

const OFFERING_ID = 'off1';
const ARTIST = 'GARTIST00000000000000000000000000000000000000000000000000';
const ESCROW_ADDR = 'CESCROW0000000000000000000000000000000000000000000000000';

const CFG = {
  usdcAddress: 'CUSDC0000000000000000000000000000000000000000000000000000',
  treasuryAddress: 'CTREASURY000000000000000000000000000000000000000000000000',
  adminPublicKey: 'GADMIN00000000000000000000000000000000000000000000000000',
};

/** total_supply − artist_retention − treasury_retention = 850_000. */
const CONTRACT = {
  id: 'fc1',
  totalSupply: '1000000',
  artistAddress: ARTIST,
  artistRetentionAmount: '100000',
  treasuryRetentionAmount: '50000',
};

const OFFERING = {
  id: OFFERING_ID,
  fractionContractId: 'fc1',
  escrowDeployStatus: 'deploying' as string | null,
  publicFloat: '850000',
  snapshotArtistAddress: ARTIST,
};

function build(
  overrides: {
    offering?: object | null;
    contract?: object | null;
    deployImpl?: () => Promise<unknown>;
    casDeployed?: boolean;
  } = {},
) {
  const manager = { __tag: 'manager' };

  const offerings = {
    findOneById: vi.fn(() =>
      Promise.resolve('offering' in overrides ? overrides.offering : { ...OFFERING }),
    ),
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
    casEscrowDeployed: vi.fn(() => Promise.resolve(overrides.casDeployed ?? true)),
    casEscrowFailed: vi.fn(() => Promise.resolve(true)),
  };
  const approvals = {
    softDeleteAllForOffering: vi.fn(() => Promise.resolve(undefined)),
  };
  const fractionContracts = {
    findOneById: vi.fn(() =>
      Promise.resolve('contract' in overrides ? overrides.contract : { ...CONTRACT }),
    ),
  };
  const escrow = {
    deployEscrow: vi.fn(
      overrides.deployImpl ??
        (() => Promise.resolve({ contractAddress: ESCROW_ADDR, txHash: 'tx123' })),
    ),
  };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };

  const processor = new OfferingEscrowDeployProcessor(
    offerings as never,
    approvals as never,
    fractionContracts as never,
    escrow as never,
    CFG as never,
    audit as never,
  );

  return { processor, offerings, approvals, fractionContracts, escrow, audit };
}

const run = (h: ReturnType<typeof build>, offeringId = OFFERING_ID) =>
  h.processor.process({ data: { offeringId } } as never);

describe('OfferingEscrowDeployProcessor.process', () => {
  beforeEach(() => vi.clearAllMocks());

  it('U10: happy path — deploy, CAS-win latch, soft-delete approvals, audit DEPLOYED', async () => {
    const h = build();
    await expect(run(h)).resolves.toBeUndefined();

    // deploy called with mapped ABI args
    expect(h.escrow.deployEscrow).toHaveBeenCalledOnce();
    expect(h.escrow.deployEscrow).toHaveBeenCalledWith({
      offeringId: OFFERING_ID,
      args: {
        usdc: CFG.usdcAddress,
        totalSupply: 1_000_000n,
        artist: ARTIST,
        artistRetention: 100_000n,
        treasury: CFG.treasuryAddress,
        treasuryRetention: 50_000n,
        artistPayout: ARTIST,
        admin: CFG.adminPublicKey,
      },
    });

    expect(h.offerings.casEscrowDeployed).toHaveBeenCalledWith(expect.anything(), OFFERING_ID, {
      address: ESCROW_ADDR,
    });
    expect(h.approvals.softDeleteAllForOffering).toHaveBeenCalledOnce();
    expect(h.audit.record).toHaveBeenCalledOnce();
    expect(h.audit.record.mock.calls[0][0]).toMatchObject({
      kind: AUDIT_KIND.OFFERING_ESCROW_DEPLOYED,
      subjectId: OFFERING_ID,
      payload: { contractAddress: ESCROW_ADDR, txHash: 'tx123' },
    });
    expect(h.offerings.casEscrowFailed).not.toHaveBeenCalled();
  });

  it('U11: retryable throttled error → rethrows, casEscrowFailed NOT called', async () => {
    const h = build({ deployImpl: () => Promise.reject(new OfferingEscrowThrottledError()) });
    await expect(run(h)).rejects.toBeInstanceOf(OfferingEscrowThrottledError);
    expect(h.offerings.casEscrowFailed).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it('U12: terminal escrow error → casEscrowFailed + audit FAILED + throws UnrecoverableError', async () => {
    const h = build({
      deployImpl: () => Promise.reject(new OfferingEscrowError('host reject', false)),
    });
    await expect(run(h)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.offerings.casEscrowFailed).toHaveBeenCalledOnce();
    expect(h.audit.record).toHaveBeenCalledOnce();
    expect(h.audit.record.mock.calls[0][0]).toMatchObject({
      kind: AUDIT_KIND.OFFERING_ESCROW_DEPLOY_FAILED,
      subjectId: OFFERING_ID,
    });
    // reason is sanitized (bounded single-line) — not the raw error object
    const payload = h.audit.record.mock.calls[0][0].payload as { reason: string };
    expect(payload.reason).toContain('OfferingEscrowError');
  });

  it('U13: guard — escrowDeployStatus="deployed" → early return, deployEscrow NOT called', async () => {
    const h = build({ offering: { ...OFFERING, escrowDeployStatus: 'deployed' } });
    await expect(run(h)).resolves.toBeUndefined();
    expect(h.fractionContracts.findOneById).not.toHaveBeenCalled();
    expect(h.escrow.deployEscrow).not.toHaveBeenCalled();
  });

  it('U13: guard — escrowDeployStatus=null → early return, deployEscrow NOT called', async () => {
    const h = build({ offering: { ...OFFERING, escrowDeployStatus: null } });
    await expect(run(h)).resolves.toBeUndefined();
    expect(h.escrow.deployEscrow).not.toHaveBeenCalled();
  });

  it('U13b: offering not found → early return, deployEscrow NOT called', async () => {
    const h = build({ offering: null });
    await expect(run(h)).resolves.toBeUndefined();
    expect(h.fractionContracts.findOneById).not.toHaveBeenCalled();
    expect(h.escrow.deployEscrow).not.toHaveBeenCalled();
  });

  it('U14: casEscrowDeployed=false (already latched) → no soft-delete, no audit, no throw', async () => {
    const h = build({ casDeployed: false });
    await expect(run(h)).resolves.toBeUndefined();
    expect(h.escrow.deployEscrow).toHaveBeenCalledOnce();
    expect(h.approvals.softDeleteAllForOffering).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it('U15: public_float mismatch → thrown INSIDE try → terminal path (casEscrowFailed + UnrecoverableError), deployEscrow NOT called', async () => {
    // assertPublicFloatMatches runs before deployEscrow but inside the try, so its terminal
    // EscrowParamDriftError (retryable=false) falls through to the catch → latch failed + audit.
    const h = build({ offering: { ...OFFERING, publicFloat: '999999' } });
    await expect(run(h)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.escrow.deployEscrow).not.toHaveBeenCalled();
    expect(h.offerings.casEscrowFailed).toHaveBeenCalledOnce();
    expect(h.audit.record.mock.calls[0][0]).toMatchObject({
      kind: AUDIT_KIND.OFFERING_ESCROW_DEPLOY_FAILED,
    });
  });

  it('U15b: snapshotArtistAddress drift → terminal EscrowParamDriftError, deployEscrow NOT called, casEscrowFailed called', async () => {
    const h = build({
      offering: { ...OFFERING, snapshotArtistAddress: 'GDIFFERENT000000000000000000000000000000000000000000000000' },
    });
    await expect(run(h)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.escrow.deployEscrow).not.toHaveBeenCalled();
    expect(h.offerings.casEscrowFailed).toHaveBeenCalledOnce();
    expect(h.audit.record.mock.calls[0][0]).toMatchObject({
      kind: AUDIT_KIND.OFFERING_ESCROW_DEPLOY_FAILED,
    });
  });
});
