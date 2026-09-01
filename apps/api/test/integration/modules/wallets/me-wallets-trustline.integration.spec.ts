import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { UsersModule } from '@modules/users/users.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { WalletsService } from '@modules/wallets/wallets.service';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { MeWalletsService } from '@modules/wallets/me/me-wallets.service';
import { Wallet } from '@modules/wallets/entities/wallet.entity';
import { User } from '@modules/users/entities/user.entity';
import type { Sep10Service } from '@modules/auth/sep10.service';
import { InMemoryIdempotencyStore } from '../../../shared/in-memory-idempotency-store';
import { FakeWalletTrustlineService } from '../../../shared/fake-wallet-trustline';
import type { IdempotencyStore } from '@common/idempotency/idempotency-store';

const PK_A = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const PK_B = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const TRUSTLINE_INSTRUCTION = {
  changeTrustXdr: 'XDR',
  asset: { code: 'USDC', issuer: PK_B },
};

/** Consume-challenge callback stub: succeeds (SEP-10 crypto is covered by the Sep10 suites). */
const consumeOk = () => Promise.resolve(true);

/**
 * Integration coverage for the TOV-32 BYOW USDC-trustline enrichment on `MeWalletsService.add`, wired to
 * the REAL DB-backed {@link WalletsService} (persistence + idempotency) with only the on-chain trustline
 * port and the SEP-10 verify faked. Proves the add-response `trustlineRequired` field, the never-cached
 * re-resolve on replay, and the P1 guard (a throwing port after `complete()` never corrupts idempotency).
 */
describe('MeWalletsService add + trustline Integration (TOV-32)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let walletsService: WalletsService;
  let auditService: AuditLogService;

  const createUser = () => dataSource.getRepository(User).save(dataSource.getRepository(User).create({}));
  const walletCount = (where: object) => dataSource.getRepository(Wallet).count({ where });

  /** Build the subject with a real DB-backed WalletsService + a fresh fake trustline port per test. */
  const buildService = (fakeTrustline: FakeWalletTrustlineService): MeWalletsService => {
    const stubSep10 = {
      verifyBindChallenge: () => Promise.resolve({ publicKey: PK_A, consume: consumeOk }),
    } satisfies Pick<Sep10Service, 'verifyBindChallenge'>;
    return new MeWalletsService(
      stubSep10 as unknown as Sep10Service,
      walletsService,
      new InMemoryIdempotencyStore() as unknown as IdempotencyStore,
      auditService,
      fakeTrustline,
    );
  };

  beforeAll(async () => {
    module = await createTestingModule(UsersModule, WalletsModule, WalletsAuditModule);
    dataSource = module.get(DataSource);
    walletsService = module.get(WalletsService);
    auditService = module.get(AuditLogService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  it('persists the bound wallet AND attaches trustlineRequired when the port has an instruction', async () => {
    const user = await createUser();
    const fakeTrustline = new FakeWalletTrustlineService();
    fakeTrustline.instructions.set(PK_A, TRUSTLINE_INSTRUCTION);
    const service = buildService(fakeTrustline);

    const dto = await service.add(user.id, 'idem-1', { signedChallengeXdr: 'x' });

    expect(dto.trustlineRequired).toEqual(TRUSTLINE_INSTRUCTION);
    expect(await walletCount({ userId: user.id })).toBe(1);
    const persisted = await dataSource.getRepository(Wallet).findOneByOrFail({ userId: user.id });
    expect(persisted.publicKey).toBe(PK_A);
    expect(persisted.kind).toBe('byow');
  });

  it('omits trustlineRequired when the port returns null, still persisting the wallet', async () => {
    const user = await createUser();
    const fakeTrustline = new FakeWalletTrustlineService(); // unseeded → resolves null by default
    const service = buildService(fakeTrustline);

    const dto = await service.add(user.id, 'idem-1', { signedChallengeXdr: 'x' });

    expect(dto.trustlineRequired).toBeUndefined();
    expect(await walletCount({ userId: user.id })).toBe(1);
    const persisted = await dataSource.getRepository(Wallet).findOneByOrFail({ userId: user.id });
    expect(persisted.publicKey).toBe(PK_A);
  });

  it('re-resolves the instruction on an idempotent replay (fresh, never cached) with no second row', async () => {
    const user = await createUser();
    const fakeTrustline = new FakeWalletTrustlineService();
    fakeTrustline.instructions.set(PK_A, TRUSTLINE_INSTRUCTION);
    const service = buildService(fakeTrustline);

    const first = await service.add(user.id, 'idem-1', { signedChallengeXdr: 'x' });
    const replay = await service.add(user.id, 'idem-1', { signedChallengeXdr: 'x' });

    expect(replay.id).toBe(first.id); // same persisted wallet, owner-scoped reload
    expect(replay.trustlineRequired).toEqual(TRUSTLINE_INSTRUCTION);
    expect(fakeTrustline.calls).toBe(2); // resolved on BOTH the fresh call and the replay
    expect(await walletCount({ userId: user.id })).toBe(1); // bound only once
  });

  it('a throwing port after complete() does not corrupt idempotency — retry replays the persisted wallet (P1 guard)', async () => {
    const user = await createUser();
    const fakeTrustline = new FakeWalletTrustlineService();
    fakeTrustline.error = new Error('rpc down'); // the resolve runs AFTER complete() — must not reach fail()
    const service = buildService(fakeTrustline);

    await expect(service.add(user.id, 'idem-1', { signedChallengeXdr: 'x' })).rejects.toThrow('rpc down');

    // The wallet was bound + the idempotency record completed BEFORE the enrichment threw. A same-key retry
    // must replay it WITHOUT re-consuming the single-use challenge (i.e. fail() did not delete the record).
    fakeTrustline.error = null;
    const retry = await service.add(user.id, 'idem-1', { signedChallengeXdr: 'x' });

    expect(retry.publicKey).toBe(PK_A);
    expect(await walletCount({ userId: user.id })).toBe(1);
  });
});
