import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { UsersModule } from '@modules/users/users.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { WalletsService } from '@modules/wallets/wallets.service';
import { Wallet } from '@modules/wallets/entities/wallet.entity';
import { User } from '@modules/users/entities/user.entity';

const PUBLIC_KEY = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const OTHER_PUBLIC_KEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

describe('WalletsService Integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let walletsService: WalletsService;

  beforeAll(async () => {
    // UsersModule registers the User entity that WalletsService creates in-transaction.
    module = await createTestingModule(UsersModule, WalletsModule);
    dataSource = module.get(DataSource);
    walletsService = module.get(WalletsService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  it('creates a wallet-only user + wallet on first sight', async () => {
    const { user, wallet } = await walletsService.findOrCreateForWallet(PUBLIC_KEY);

    expect(user.id).toBeDefined();
    expect(user.email).toBeNull();
    expect(user.passwordHash).toBeNull();
    expect(wallet.publicKey).toBe(PUBLIC_KEY);
    expect(wallet.kind).toBe('byow');
  });

  it('returns the same user + wallet for a returning active wallet', async () => {
    const first = await walletsService.findOrCreateForWallet(PUBLIC_KEY);
    const second = await walletsService.findOrCreateForWallet(PUBLIC_KEY);

    expect(second.user.id).toBe(first.user.id);
    expect(second.wallet.id).toBe(first.wallet.id);
    expect(await dataSource.getRepository(User).count()).toBe(1);
  });

  it('reactivates a soft-deleted wallet instead of forking a new user', async () => {
    const first = await walletsService.findOrCreateForWallet(PUBLIC_KEY);

    // Soft-delete the wallet (the capability exists via BaseRepository.softRemove).
    await dataSource.getRepository(Wallet).softDelete(first.wallet.id);

    const again = await walletsService.findOrCreateForWallet(PUBLIC_KEY);

    // Same user + same wallet row, now active again — no fork.
    expect(again.user.id).toBe(first.user.id);
    expect(again.wallet.id).toBe(first.wallet.id);
    expect(again.wallet.deletedAt).toBeNull();
    expect(await dataSource.getRepository(User).count()).toBe(1);
    expect(await dataSource.getRepository(Wallet).count()).toBe(1);
  });

  it('reactivation recomputes is_primary on login (no duplicate-primary 500) [TOV-24 #144]', async () => {
    // User with a live primary B; wallet A was primary but is now soft-deleted with the stale flag frozen.
    const { user } = await walletsService.findOrCreateForWallet(PUBLIC_KEY); // A → primary
    const walletRepo = dataSource.getRepository(Wallet);
    const b = await walletRepo.save(
      walletRepo.create({ userId: user.id, publicKey: OTHER_PUBLIC_KEY, kind: 'byow', isPrimary: false }),
    );
    const a = await walletRepo.findOneByOrFail({ publicKey: PUBLIC_KEY });
    // Soft-delete A while it still holds is_primary=true (freezes the stale flag), THEN promote B — so
    // there are never two LIVE primaries at once (the partial index only counts live rows).
    await walletRepo.softDelete(a.id);
    await walletRepo.update(b.id, { isPrimary: true });

    // Logging back in with A must reactivate it WITHOUT resurrecting a second primary (would 500 on the index).
    const again = await walletsService.findOrCreateForWallet(PUBLIC_KEY);
    expect(again.wallet.id).toBe(a.id);
    expect(again.wallet.deletedAt).toBeNull();
    expect(again.wallet.isPrimary).toBe(false); // demoted — B is the live primary
    expect(await walletRepo.count({ where: { userId: user.id, isPrimary: true } })).toBe(1);
  });

  describe('filterKnownActiveByowAddresses (TOV-243 #440)', () => {
    const UNKNOWN = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

    it('returns only live byow bindings; excludes soft-deleted and unknown keys', async () => {
      const bound = await walletsService.findOrCreateForWallet(PUBLIC_KEY);
      const removed = await walletsService.findOrCreateForWallet(OTHER_PUBLIC_KEY);
      await dataSource.getRepository(Wallet).softDelete(removed.wallet.id);

      const known = await walletsService.filterKnownActiveByowAddresses([PUBLIC_KEY, OTHER_PUBLIC_KEY, UNKNOWN]);
      expect(known.has(PUBLIC_KEY)).toBe(true); // live binding
      expect(known.has(OTHER_PUBLIC_KEY)).toBe(false); // soft-deleted
      expect(known.has(UNKNOWN)).toBe(false); // never bound
      expect(known.size).toBe(1);
      expect(bound.wallet.kind).toBe('byow');
    });

    it('returns an empty set for an empty input (no query)', async () => {
      expect((await walletsService.filterKnownActiveByowAddresses([])).size).toBe(0);
    });
  });

  describe('embedded-wallet-per-user invariant (review #110)', () => {
    const CONTRACT_A = 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC';
    const CONTRACT_B = 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI';

    const createUser = () => dataSource.getRepository(User).save(dataSource.getRepository(User).create({}));
    const insertEmbedded = (userId: string, contractAddress: string) =>
      dataSource.getRepository(Wallet).save(
        dataSource.getRepository(Wallet).create({ userId, publicKey: null, contractAddress, kind: 'embedded_passkey' }),
      );

    it('rejects a second live embedded wallet for the same user (partial unique index)', async () => {
      const user = await createUser();
      await insertEmbedded(user.id, CONTRACT_A);
      await expect(insertEmbedded(user.id, CONTRACT_B)).rejects.toMatchObject({ code: '23505' });
    });
  });
});
