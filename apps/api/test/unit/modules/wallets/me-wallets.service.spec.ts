import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { MeWalletsService } from '../../../../src/modules/wallets/me/me-wallets.service';
import { WalletMutationError } from '../../../../src/modules/wallets/wallet-mutation.error';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { AUDIT_KIND } from '../../../../src/modules/wallets/audit/audit-log.types';
import { InMemoryIdempotencyStore } from '../../../shared/in-memory-idempotency-store';
import { FakeWalletTrustlineService } from '../../../shared/fake-wallet-trustline';
import type { Wallet } from '../../../../src/modules/wallets/entities/wallet.entity';
import type { Sep10Service } from '../../../../src/modules/auth/sep10.service';
import type {
  WalletsService,
  PrimaryChangeResult,
  PrimaryReassignment,
} from '../../../../src/modules/wallets/wallets.service';
import type { IdempotencyStore } from '../../../../src/common/idempotency/idempotency-store';
import type { AuditLogService } from '../../../../src/modules/wallets/audit/audit-log.service';

const USER = 'user-1';
const XDR = 'signed-challenge-xdr';
const IDEM = 'idem-key-123';

// Audit-callback shapes reuse the exported prod types (manager faked as `unknown` in mocks).
type SetPrimaryOnChange = (result: PrimaryChangeResult, manager: unknown) => Promise<void>;
type RemoveOnReassigned = (result: PrimaryReassignment, manager: unknown) => Promise<void>;

function walletFixture(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: 'wallet-1',
    userId: USER,
    publicKey: 'GAAA',
    contractAddress: null,
    kind: 'byow',
    status: 'active',
    isPrimary: false,
    removedAt: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    ...overrides,
  } as Wallet;
}

/** Recompute the service's idempotency key + body fingerprint to seed the store for in-flight tests. */
function idemKey(userId: string, key: string): string {
  return `idem:me-wallets-add:${userId}:${key}`;
}
function fingerprint(xdr: string): string {
  return createHash('sha256').update(JSON.stringify({ signedChallengeXdr: xdr })).digest('hex');
}

function errorCodeOf(err: unknown): string | undefined {
  if (err instanceof HttpException) {
    const res = err.getResponse() as { errorCode?: string };
    return res.errorCode;
  }
  return undefined;
}

describe('MeWalletsService', () => {
  let sep10: { buildChallenge: ReturnType<typeof vi.fn>; verifyBindChallenge: ReturnType<typeof vi.fn> };
  let wallets: {
    bindByowWalletToUser: ReturnType<typeof vi.fn>;
    removeWallet: ReturnType<typeof vi.fn>;
    findOwnedWallet: ReturnType<typeof vi.fn>;
    setPrimaryWallet: ReturnType<typeof vi.fn>;
  };
  let audit: { record: ReturnType<typeof vi.fn> };
  let idempotency: InMemoryIdempotencyStore;
  let trustline: FakeWalletTrustlineService;
  let service: MeWalletsService;

  const TRUSTLINE_INSTRUCTION = {
    changeTrustXdr: 'AAAA-change-trust-xdr',
    asset: { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
  };

  beforeEach(() => {
    const consume = vi.fn();
    sep10 = {
      buildChallenge: vi.fn(),
      verifyBindChallenge: vi.fn().mockResolvedValue({ publicKey: 'GAAA', consume }),
    };
    wallets = {
      bindByowWalletToUser: vi.fn().mockResolvedValue(walletFixture()),
      removeWallet: vi.fn().mockResolvedValue({ promotedWalletId: null }),
      findOwnedWallet: vi.fn().mockResolvedValue(walletFixture()),
      // Default: a real change — invoke the audit callback the service supplies (so we can assert audit).
      setPrimaryWallet: vi
        .fn()
        .mockImplementation(async (_userId: string, walletId: string, onChange: SetPrimaryOnChange) => {
          await onChange({ changed: true, previousWalletId: 'wallet-0' }, {});
          return walletFixture({ id: walletId, isPrimary: true });
        }),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    idempotency = new InMemoryIdempotencyStore();
    trustline = new FakeWalletTrustlineService();
    service = new MeWalletsService(
      sep10 as unknown as Sep10Service,
      wallets as unknown as WalletsService,
      idempotency as unknown as IdempotencyStore,
      audit as unknown as AuditLogService,
      trustline,
    );
  });

  describe('issueChallenge', () => {
    it('delegates to Sep10Service with the caller id (user-bound challenge)', async () => {
      sep10.buildChallenge.mockResolvedValue({ challengeTxXdr: 'x', networkPassphrase: 'n' });
      await service.issueChallenge(USER, 'GAAA');
      expect(sep10.buildChallenge).toHaveBeenCalledWith('GAAA', USER);
    });
  });

  describe('add', () => {
    it('verifies, binds, and returns the wallet DTO on the first call', async () => {
      const dto = await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      expect(sep10.verifyBindChallenge).toHaveBeenCalledWith(XDR, USER);
      expect(wallets.bindByowWalletToUser).toHaveBeenCalledOnce();
      expect(dto.id).toBe('wallet-1');
      expect(dto.isPrimary).toBe(false);
    });

    it('attaches trustlineRequired when the byow wallet lacks the USDC trustline (TOV-32)', async () => {
      trustline.instructions.set('GAAA', TRUSTLINE_INSTRUCTION);
      const dto = await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      expect(dto.trustlineRequired).toEqual(TRUSTLINE_INSTRUCTION);
      expect(trustline.calls).toBe(1);
    });

    it('omits trustlineRequired when the account already trusts USDC (port → null)', async () => {
      trustline.instructions.set('GAAA', null);
      const dto = await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      expect(dto.trustlineRequired).toBeUndefined();
    });

    it('re-resolves the instruction on replay (fresh, never cached)', async () => {
      trustline.instructions.set('GAAA', TRUSTLINE_INSTRUCTION);
      await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      const replay = await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      expect(replay.trustlineRequired).toEqual(TRUSTLINE_INSTRUCTION);
      expect(trustline.calls).toBe(2); // resolved on BOTH the fresh call and the replay
      expect(wallets.bindByowWalletToUser).toHaveBeenCalledOnce(); // but bound only once
    });

    it('a throwing trustline port after complete() does NOT corrupt idempotency (P1 guard)', async () => {
      trustline.error = new Error('rpc down'); // the resolve runs AFTER complete() — must not reach fail()
      await expect(service.add(USER, IDEM, { signedChallengeXdr: XDR })).rejects.toThrow('rpc down');
      // The completed record survives: a retry replays the bound wallet WITHOUT re-running the
      // (single-use) SEP-10 challenge — i.e. fail() did not delete the record.
      trustline.error = null;
      const retry = await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      expect(retry.id).toBe('wallet-1');
      expect(wallets.bindByowWalletToUser).toHaveBeenCalledOnce();
      expect(wallets.findOwnedWallet).toHaveBeenCalledWith(USER, 'wallet-1'); // replay path
    });

    it('replays the stored result on a same-key + same-body retry (no re-bind)', async () => {
      await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      const replay = await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      expect(wallets.bindByowWalletToUser).toHaveBeenCalledOnce(); // not called again
      expect(wallets.findOwnedWallet).toHaveBeenCalledWith(USER, 'wallet-1'); // owner-scoped reload
      expect(replay.id).toBe('wallet-1');
    });

    it('rejects a same-key + different-body reuse with 422', async () => {
      await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      await expect(
        service.add(USER, IDEM, { signedChallengeXdr: 'a-different-xdr' }),
      ).rejects.toSatisfy(
        (e) => errorCodeOf(e) === ErrorCode.IDEMPOTENCY_KEY_MISMATCH && (e as HttpException).getStatus() === 422,
      );
    });

    it('rejects a concurrent in-flight duplicate with 409', async () => {
      // Seed a PENDING record for the same key+fingerprint (simulates the first request still running).
      await idempotency.begin(idemKey(USER, IDEM), fingerprint(XDR));
      await expect(service.add(USER, IDEM, { signedChallengeXdr: XDR })).rejects.toSatisfy(
        (e) => errorCodeOf(e) === ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT && (e as HttpException).getStatus() === 409,
      );
    });

    it('maps a foreign-owned pubkey to 409 WALLET_ALREADY_BOUND and releases the key for retry', async () => {
      wallets.bindByowWalletToUser.mockRejectedValueOnce(new WalletMutationError('already_bound'));
      await expect(service.add(USER, IDEM, { signedChallengeXdr: XDR })).rejects.toSatisfy(
        (e) => errorCodeOf(e) === ErrorCode.WALLET_ALREADY_BOUND,
      );
      // Key released on failure: a fresh retry re-runs the bind (not a stuck 409).
      wallets.bindByowWalletToUser.mockResolvedValueOnce(walletFixture());
      const retry = await service.add(USER, IDEM, { signedChallengeXdr: XDR });
      expect(retry.id).toBe('wallet-1');
      expect(wallets.bindByowWalletToUser).toHaveBeenCalledTimes(2);
    });

    it('passes the SEP-10 UnauthorizedException through unchanged', async () => {
      const { UnauthorizedException } = await import('@nestjs/common');
      sep10.verifyBindChallenge.mockRejectedValueOnce(new UnauthorizedException('nope'));
      await expect(service.add(USER, IDEM, { signedChallengeXdr: XDR })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('remove', () => {
    it.each([
      ['primary_cannot_be_removed', ErrorCode.PRIMARY_WALLET_CANNOT_BE_REMOVED, 409],
      ['kind_not_supported', ErrorCode.WALLET_KIND_NOT_SUPPORTED, 422],
      ['not_found', ErrorCode.WALLET_NOT_FOUND, 404],
    ] as const)('maps %s to %s (%d)', async (reason, code, status) => {
      wallets.removeWallet.mockRejectedValueOnce(new WalletMutationError(reason));
      await expect(service.remove(USER, 'wallet-1')).rejects.toSatisfy(
        (e) => errorCodeOf(e) === code && (e as HttpException).getStatus() === status,
      );
    });

    it('returns the deleted id + null new-primary on a non-primary soft-unbind', async () => {
      const res = await service.remove(USER, 'wallet-1');
      expect(res).toEqual({ deletedId: 'wallet-1', newPrimaryWalletId: null });
      expect(wallets.removeWallet).toHaveBeenCalledWith(USER, 'wallet-1', expect.any(Function));
    });

    it('records a PRIMARY_CHANGED audit row + returns the promoted wallet when a sibling is promoted', async () => {
      wallets.removeWallet.mockImplementationOnce(
        async (_userId: string, walletId: string, onReassigned: RemoveOnReassigned) => {
          await onReassigned({ previousWalletId: walletId, newWalletId: 'wallet-2' }, {});
          return { promotedWalletId: 'wallet-2' };
        },
      );
      const res = await service.remove(USER, 'wallet-1');
      expect(res).toEqual({ deletedId: 'wallet-1', newPrimaryWalletId: 'wallet-2' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: AUDIT_KIND.PRIMARY_CHANGED,
          subjectId: 'wallet-2',
          payload: { previousWalletId: 'wallet-1', newWalletId: 'wallet-2', reason: 'auto_promote' },
        }),
        expect.anything(),
      );
    });
  });

  describe('setPrimary', () => {
    it('sets the target primary and returns the updated DTO', async () => {
      const dto = await service.setPrimary(USER, 'wallet-1');
      expect(wallets.setPrimaryWallet).toHaveBeenCalledWith(USER, 'wallet-1', expect.any(Function));
      expect(dto.id).toBe('wallet-1');
      expect(dto.isPrimary).toBe(true);
    });

    it('never resolves a trustline (add-response-only field)', async () => {
      const dto = await service.setPrimary(USER, 'wallet-1');
      expect(dto.trustlineRequired).toBeUndefined();
      expect(trustline.calls).toBe(0);
    });

    it('records a PRIMARY_CHANGED audit row (reason user) on a real change', async () => {
      await service.setPrimary(USER, 'wallet-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'user',
          actorId: USER,
          kind: AUDIT_KIND.PRIMARY_CHANGED,
          subjectId: 'wallet-1',
          payload: { previousWalletId: 'wallet-0', newWalletId: 'wallet-1', reason: 'user' },
        }),
        expect.anything(),
      );
    });

    it('writes NO audit row when re-setting the current primary (idempotent no-op)', async () => {
      wallets.setPrimaryWallet.mockImplementationOnce(
        async (_userId: string, walletId: string, onChange: SetPrimaryOnChange) => {
          await onChange({ changed: false, previousWalletId: null }, {}); // no-op: nothing demoted
          return walletFixture({ id: walletId, isPrimary: true });
        },
      );
      const dto = await service.setPrimary(USER, 'wallet-1');
      expect(dto.isPrimary).toBe(true);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each([
      ['not_eligible_for_primary', ErrorCode.WALLET_NOT_ELIGIBLE_FOR_PRIMARY, 409],
      ['kind_not_supported', ErrorCode.WALLET_KIND_NOT_SUPPORTED, 422],
      ['not_found', ErrorCode.WALLET_NOT_FOUND, 404],
    ] as const)('maps %s to %s (%d)', async (reason, code, status) => {
      wallets.setPrimaryWallet.mockRejectedValueOnce(new WalletMutationError(reason));
      await expect(service.setPrimary(USER, 'wallet-1')).rejects.toSatisfy(
        (e) => errorCodeOf(e) === code && (e as HttpException).getStatus() === status,
      );
    });
  });
});
