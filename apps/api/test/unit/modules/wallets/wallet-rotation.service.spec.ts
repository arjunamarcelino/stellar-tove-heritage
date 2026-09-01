import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { WalletRotationService } from '../../../../src/modules/wallets/rotation/wallet-rotation.service';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { AUDIT_KIND } from '../../../../src/modules/wallets/audit/audit-log.types';
import { FractionReadUnavailableError } from '../../../../src/modules/fractionalization/fraction-read.errors';
import { createSoftwarePasskey } from '../../../shared/webauthn-authenticator';
import type { webauthnConfig } from '../../../../src/config/webauthn.config';
import type { Wallet } from '../../../../src/modules/wallets/entities/wallet.entity';
import type { IRelayerService } from '../../../../src/modules/relayer/relayer.service.interface';
import type { IFractionContractRepository } from '../../../../src/modules/fractionalization/repositories/fraction-contract-repository.interface';
import type { FractionContract } from '../../../../src/modules/fractionalization/entities/fraction-contract.entity';
import type { IKycAllowlistTxService } from '../../../../src/modules/kyc-allowlist/kyc-allowlist-tx.service.interface';
import type { IWalletRotationRepository } from '../../../../src/modules/wallets/rotation/repositories/wallet-rotation-repository.interface';
import type { WalletsService } from '../../../../src/modules/wallets/wallets.service';
import type { AuditLogService } from '../../../../src/modules/wallets/audit/audit-log.service';

const SOURCE_ID = 'w-src';
const DEST_ID = 'w-dst';
const USER = 'user-1';
const SOURCE_CONTRACT = 'C' + 'A'.repeat(55);
const DEST_PUBKEY = 'G' + 'B'.repeat(55);
const TOKEN = 'C' + 'D'.repeat(55);

function errorCodeOf(err: unknown): string | undefined {
  if (err instanceof HttpException) return (err.getResponse() as { errorCode?: string }).errorCode;
  return undefined;
}

function sourceWallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: SOURCE_ID,
    userId: USER,
    kind: 'embedded_passkey',
    contractAddress: SOURCE_CONTRACT,
    publicKey: null,
    isPrimary: false,
    status: 'active',
    removedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  } as Wallet;
}
function destWallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: DEST_ID,
    userId: USER,
    kind: 'byow',
    contractAddress: null,
    publicKey: DEST_PUBKEY,
    isPrimary: true,
    status: 'active',
    removedAt: null,
    createdAt: new Date('2026-07-02T00:00:00Z'),
    ...overrides,
  } as Wallet;
}
function contract(overrides: Partial<FractionContract> = {}): FractionContract {
  return {
    tokenAddress: TOKEN,
    artistAddress: 'C' + 'Z'.repeat(55), // NOT the source → collector position, never locked
    artistLockupUntil: null,
    artistRetentionAmount: null,
    ...overrides,
  } as FractionContract;
}

interface Harness {
  service: WalletRotationService;
  relayer: { buildTransfer: ReturnType<typeof vi.fn>; submitSignedTransfer: ReturnType<typeof vi.fn>; readWalletHoldings: ReturnType<typeof vi.fn> };
  rotationRepo: Record<keyof IWalletRotationRepository, ReturnType<typeof vi.fn>>;
  registry: { recordCustodyTransfer: ReturnType<typeof vi.fn> };
  fractionRead: { balancesOf: ReturnType<typeof vi.fn> };
  fractionContracts: { findAllDeployed: ReturnType<typeof vi.fn> };
  allowlist: { isAllowed: ReturnType<typeof vi.fn> };
  exportsRepo: { findOne: ReturnType<typeof vi.fn> };
  wallets: { findOwnedWallet: ReturnType<typeof vi.fn>; getWalletCredential: ReturnType<typeof vi.fn>; resolvePrimarySettlementAddress: ReturnType<typeof vi.fn> };
  audit: { record: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const relayer = {
    buildTransfer: vi.fn().mockResolvedValue({ txXdr: 'unsigned-xdr', challenge: 'chal', expiresAtLedger: 1000 }),
    submitSignedTransfer: vi.fn(),
    readWalletHoldings: vi.fn(),
  };
  const rotationRepo = {
    findActiveBySourceWithItems: vi.fn().mockResolvedValue(null),
    findOwnedWithItems: vi.fn(),
    findLatestBySourceWithItems: vi.fn(),
    createRotation: vi
      .fn()
      .mockImplementation((sourceWalletId: string, userId: string, destinationWalletId: string, destinationAddress: string) =>
        Promise.resolve({ id: 'rot-1', sourceWalletId, userId, destinationWalletId, destinationAddress, items: [] }),
      ),
    upsertItemBuild: vi
      .fn()
      .mockImplementation((input: { rotationId: string; tokenContract: string; amountScaled: string }) =>
        Promise.resolve({ id: 'item-1', tokenContract: input.tokenContract, amountScaled: input.amountScaled, status: 'pending' }),
      ),
    claimItemForSubmit: vi.fn().mockResolvedValue(true),
    markItemConfirmed: vi.fn(),
    reconcileItemConfirmed: vi.fn(),
    markItemFailed: vi.fn(),
    finalizeIfAllConfirmed: vi.fn().mockResolvedValue(false),
    softCancel: vi.fn().mockResolvedValue(undefined),
  } as unknown as Record<keyof IWalletRotationRepository, ReturnType<typeof vi.fn>>;
  const registry = { recordCustodyTransfer: vi.fn().mockResolvedValue(undefined) };
  const fractionRead = { balancesOf: vi.fn().mockResolvedValue(new Map([[TOKEN, '100']])) };
  const fractionContracts = { findAllDeployed: vi.fn().mockResolvedValue([contract()]) };
  const allowlist = { isAllowed: vi.fn().mockResolvedValue(true) };
  const exportsRepo = { findOne: vi.fn().mockResolvedValue(null) };
  const wallets = {
    findOwnedWallet: vi
      .fn()
      .mockImplementation((_uid: string, wid: string) =>
        Promise.resolve(wid === SOURCE_ID ? sourceWallet() : wid === DEST_ID ? destWallet() : null),
      ),
    getWalletCredential: vi.fn().mockResolvedValue({ credentialId: 'cred-1', transports: 'internal', publicKey: [] }),
    resolvePrimarySettlementAddress: vi.fn().mockResolvedValue(DEST_PUBKEY),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  const service = new WalletRotationService(
    { rpId: 'tove.app', origins: ['https://tove.app'] } as unknown as ConfigType<typeof webauthnConfig>,
    relayer as unknown as IRelayerService,
    rotationRepo,
    registry,
    fractionRead,
    fractionContracts as unknown as IFractionContractRepository,
    allowlist as unknown as IKycAllowlistTxService,
    { findOne: exportsRepo.findOne } as never,
    wallets as unknown as WalletsService,
    audit as unknown as AuditLogService,
  );
  return { service, relayer, rotationRepo, registry, fractionRead, fractionContracts, allowlist, exportsRepo, wallets, audit };
}

describe('WalletRotationService.initiate', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  const run = () => h.service.initiate(USER, SOURCE_ID, { destinationWalletId: DEST_ID });

  it('404 WALLET_NOT_FOUND when the source is not owned', async () => {
    h.wallets.findOwnedWallet.mockResolvedValue(null);
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.WALLET_NOT_FOUND);
  });

  it('422 ROTATION_SOURCE_INVALID when the source is a BYOW wallet', async () => {
    h.wallets.findOwnedWallet.mockImplementation((_u: string, wid: string) =>
      Promise.resolve(wid === SOURCE_ID ? sourceWallet({ kind: 'byow', contractAddress: null }) : destWallet()),
    );
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.ROTATION_SOURCE_INVALID);
  });

  it('409 ALREADY_EXPORTED when the source is already exported', async () => {
    h.wallets.findOwnedWallet.mockImplementation((_u: string, wid: string) =>
      Promise.resolve(wid === SOURCE_ID ? sourceWallet({ status: 'exported' }) : destWallet()),
    );
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.ALREADY_EXPORTED);
  });

  it('422 ROTATION_DESTINATION_INVALID when the destination is embedded / has no public key', async () => {
    h.wallets.findOwnedWallet.mockImplementation((_u: string, wid: string) =>
      Promise.resolve(wid === SOURCE_ID ? sourceWallet() : destWallet({ kind: 'embedded_passkey', publicKey: null })),
    );
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.ROTATION_DESTINATION_INVALID);
  });

  it('409 ROTATION_DESTINATION_NOT_PRIMARY when the destination is not the primary', async () => {
    h.wallets.findOwnedWallet.mockImplementation((_u: string, wid: string) =>
      Promise.resolve(wid === SOURCE_ID ? sourceWallet() : destWallet({ isPrimary: false })),
    );
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.ROTATION_DESTINATION_NOT_PRIMARY);
  });

  it('409 ROTATION_CONFLICT when an export is active on the source', async () => {
    h.exportsRepo.findOne.mockResolvedValue({ id: 'exp-1' });
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.ROTATION_CONFLICT);
  });

  it('422 ROTATION_NOTHING_TO_TRANSFER when the source holds no non-zero fractions', async () => {
    h.fractionRead.balancesOf.mockResolvedValue(new Map([[TOKEN, '0']]));
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.ROTATION_NOTHING_TO_TRANSFER);
  });

  it('422 ROTATION_BLOCKED_BY_LOCKUP when the source holds a locked artist retention position', async () => {
    const future = String(Math.floor(Date.now() / 1000) + 100000);
    h.fractionContracts.findAllDeployed.mockResolvedValue([
      contract({ artistAddress: SOURCE_CONTRACT, artistLockupUntil: future, artistRetentionAmount: '50' }),
    ]);
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.ROTATION_BLOCKED_BY_LOCKUP);
  });

  it('does NOT block a collector (source is not the artist) even within a lockup window', async () => {
    const future = String(Math.floor(Date.now() / 1000) + 100000);
    h.fractionContracts.findAllDeployed.mockResolvedValue([
      contract({ artistAddress: 'C' + 'Z'.repeat(55), artistLockupUntil: future, artistRetentionAmount: '50' }),
    ]);
    await expect(run()).resolves.toBeDefined();
  });

  it('does NOT block when the lockup has elapsed', async () => {
    const past = String(Math.floor(Date.now() / 1000) - 100000);
    h.fractionContracts.findAllDeployed.mockResolvedValue([
      contract({ artistAddress: SOURCE_CONTRACT, artistLockupUntil: past, artistRetentionAmount: '50' }),
    ]);
    await expect(run()).resolves.toBeDefined();
  });

  it('422 RECIPIENT_NOT_WHITELISTED when the destination is not on the allowlist', async () => {
    h.allowlist.isAllowed.mockResolvedValue(false);
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.RECIPIENT_NOT_WHITELISTED);
  });

  it('503 HOLDINGS_UNAVAILABLE when the balance read fails', async () => {
    h.fractionRead.balancesOf.mockRejectedValue(new FractionReadUnavailableError('rpc down'));
    await expect(run()).rejects.toSatisfy((e) => errorCodeOf(e) === ErrorCode.HOLDINGS_UNAVAILABLE);
  });

  it('happy path: builds a transfer per holding, creates the rotation, audits requested', async () => {
    const res = await run();
    expect(res.rotationId).toBe('rot-1');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ tokenContract: TOKEN, amountScaled: '100', challenge: 'chal' });
    expect(h.relayer.buildTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ walletContract: SOURCE_CONTRACT, to: DEST_PUBKEY, amountScaled: '100' }),
    );
    expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ kind: AUDIT_KIND.ROTATION_REQUESTED }));
  });

  it('reads the SOURCE contract for balances — never resolvePrimarySettlementAddress (the trap)', async () => {
    await run();
    expect(h.fractionRead.balancesOf).toHaveBeenCalledWith([TOKEN], SOURCE_CONTRACT);
    expect(h.wallets.resolvePrimarySettlementAddress).not.toHaveBeenCalled();
  });
});

describe('WalletRotationService.submit — allowlist-throw-after-claim recovery (todo 429)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
    // A real COSE key so decodeCoseToRawP256 succeeds and the loop is reached.
    h.wallets.getWalletCredential.mockResolvedValue({
      credentialId: 'cred-1',
      transports: 'internal',
      publicKey: Array.from(createSoftwarePasskey().cosePublicKey),
    });
    h.rotationRepo.findOwnedWithItems.mockResolvedValue({
      id: 'rot-1',
      userId: USER,
      sourceWalletId: SOURCE_ID,
      destinationWalletId: DEST_ID,
      destinationAddress: DEST_PUBKEY,
      items: [{ id: 'item-1', status: 'pending', unsignedTxXdr: 'xdr', tokenContract: TOKEN, amountScaled: '5', txHash: null, ledger: null }],
    });
  });

  it('a thrown allowlist read AFTER the claim fails the item RECOVERABLY (not stuck submitted)', async () => {
    // Pre-loop check passes; the per-item (post-claim) re-check throws (RPC blip).
    h.allowlist.isAllowed.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('rpc down'));
    const res = await h.service.submit(USER, SOURCE_ID, {
      rotationId: 'rot-1',
      items: [{ itemId: 'item-1', authenticatorData: 'AA', clientDataJSON: 'BB', signature: 'CC' }],
    });
    // The item is failed (re-buildable on re-initiate) — NEVER left claimed 'submitted', which would wedge it.
    expect(h.rotationRepo.markItemFailed).toHaveBeenCalledWith('item-1', ErrorCode.TRANSFER_UNAVAILABLE);
    expect(res.items[0]).toMatchObject({ itemId: 'item-1', status: 'failed', errorCode: ErrorCode.TRANSFER_UNAVAILABLE });
    expect(h.relayer.submitSignedTransfer).not.toHaveBeenCalled();
  });
});

describe('WalletRotationService.cancel', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('404 WALLET_NOT_FOUND when the source is not owned', async () => {
    h.wallets.findOwnedWallet.mockResolvedValue(null);
    await expect(h.service.cancel(USER, SOURCE_ID)).rejects.toSatisfy(
      (e) => errorCodeOf(e) === ErrorCode.WALLET_NOT_FOUND,
    );
  });

  it('404 ROTATION_NOT_FOUND when there is no active rotation', async () => {
    h.rotationRepo.findActiveBySourceWithItems.mockResolvedValue(null);
    await expect(h.service.cancel(USER, SOURCE_ID)).rejects.toSatisfy(
      (e) => errorCodeOf(e) === ErrorCode.ROTATION_NOT_FOUND,
    );
  });

  it('409 ROTATION_CANNOT_CANCEL when an item is in-flight/confirmed', async () => {
    h.rotationRepo.findActiveBySourceWithItems.mockResolvedValue({
      id: 'rot-1',
      userId: USER,
      items: [{ id: 'item-1', status: 'submitted' }],
    });
    await expect(h.service.cancel(USER, SOURCE_ID)).rejects.toSatisfy(
      (e) => errorCodeOf(e) === ErrorCode.ROTATION_CANNOT_CANCEL,
    );
    expect(h.rotationRepo.softCancel).not.toHaveBeenCalled();
  });

  it('cancels + audits when no item is in-flight', async () => {
    h.rotationRepo.findActiveBySourceWithItems.mockResolvedValue({
      id: 'rot-1',
      userId: USER,
      items: [{ id: 'item-1', status: 'pending' }],
    });
    const res = await h.service.cancel(USER, SOURCE_ID);
    expect(res.canceledId).toBe('rot-1');
    expect(h.rotationRepo.softCancel).toHaveBeenCalledWith('rot-1');
    expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ kind: AUDIT_KIND.ROTATION_CANCELED }));
  });
});
