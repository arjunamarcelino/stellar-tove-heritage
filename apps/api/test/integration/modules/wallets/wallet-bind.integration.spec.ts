import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { UsersModule } from '@modules/users/users.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { WalletsService } from '@modules/wallets/wallets.service';
import { WalletMutationError } from '@modules/wallets/wallet-mutation.error';
import { Wallet } from '@modules/wallets/entities/wallet.entity';
import { User } from '@modules/users/entities/user.entity';

const PK_A = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const PK_B = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const CONTRACT = 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC';

/** Consume-challenge callback stub: succeeds (the SEP-10 crypto is covered by the Sep10 suites). */
const consumeOk = () => Promise.resolve(true);
const consumeFail = () => Promise.resolve(false);

describe('WalletsService bind/remove Integration (TOV-24)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: WalletsService;

  const createUser = () => dataSource.getRepository(User).save(dataSource.getRepository(User).create({}));
  const walletCount = (where: object) => dataSource.getRepository(Wallet).count({ where });

  beforeAll(async () => {
    module = await createTestingModule(UsersModule, WalletsModule);
    dataSource = module.get(DataSource);
    service = module.get(WalletsService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  describe('bindByowWalletToUser', () => {
    it('binds a first wallet as primary and a second as non-primary', async () => {
      const user = await createUser();

      const first = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      expect(first.isPrimary).toBe(true);

      const second = await service.bindByowWalletToUser(user.id, PK_B, consumeOk);
      expect(second.isPrimary).toBe(false);

      expect(await walletCount({ userId: user.id })).toBe(2);
    });

    it('rejects a pubkey already bound to another collector', async () => {
      const [userA, userB] = [await createUser(), await createUser()];
      await service.bindByowWalletToUser(userA.id, PK_A, consumeOk);

      await expect(service.bindByowWalletToUser(userB.id, PK_A, consumeOk)).rejects.toMatchObject({
        reason: 'already_bound',
      });
    });

    it('is idempotent for the same owner re-binding a live pubkey (no new row)', async () => {
      const user = await createUser();
      const first = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      const again = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);

      expect(again.id).toBe(first.id);
      expect(await walletCount({ userId: user.id })).toBe(1);
    });

    it('reactivates a soft-deleted non-primary wallet, keeping it non-primary', async () => {
      const user = await createUser();
      await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // PK_A → primary
      const secondary = await service.bindByowWalletToUser(user.id, PK_B, consumeOk); // PK_B → non-primary
      await dataSource.getRepository(Wallet).softDelete(secondary.id); // remove the SECONDARY (API-realistic)

      const reactivated = await service.bindByowWalletToUser(user.id, PK_B, consumeOk);

      expect(reactivated.id).toBe(secondary.id);
      expect(reactivated.deletedAt).toBeNull();
      expect(reactivated.isPrimary).toBe(false); // PK_A is still the live primary
      expect(await walletCount({ userId: user.id })).toBe(2);
      // Exactly one live primary for the user (the invariant holds).
      expect(await walletCount({ userId: user.id, isPrimary: true })).toBe(1);
    });

    it('promotes a reactivated wallet to primary when it is the only live one', async () => {
      const user = await createUser();
      const only = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      await dataSource.getRepository(Wallet).softDelete(only.id);

      const reactivated = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      expect(reactivated.isPrimary).toBe(true);
    });

    it('leaves the challenge unconsumed (rolls back) when consume fails', async () => {
      const user = await createUser();
      await expect(service.bindByowWalletToUser(user.id, PK_A, consumeFail)).rejects.toMatchObject({
        reason: 'challenge_consumed',
      });
      expect(await walletCount({ userId: user.id })).toBe(0);
    });
  });

  describe('removeWallet', () => {
    it('soft-removes a non-primary byow wallet', async () => {
      const user = await createUser();
      await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // primary
      const secondary = await service.bindByowWalletToUser(user.id, PK_B, consumeOk);

      await service.removeWallet(user.id, secondary.id);

      expect(await walletCount({ userId: user.id })).toBe(1); // live rows only
      const withDeleted = await dataSource.getRepository(Wallet).findOne({
        where: { id: secondary.id },
        withDeleted: true,
      });
      expect(withDeleted?.deletedAt).not.toBeNull();
    });

    it('refuses removing the sole primary wallet (no eligible sibling to promote)', async () => {
      const user = await createUser();
      const primary = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      await expect(service.removeWallet(user.id, primary.id)).rejects.toMatchObject({
        reason: 'primary_cannot_be_removed',
      });
    });

    it('rejects removing an embedded wallet (offboard via export)', async () => {
      const user = await createUser();
      const embedded = await dataSource.getRepository(Wallet).save(
        dataSource.getRepository(Wallet).create({
          userId: user.id,
          publicKey: null,
          contractAddress: CONTRACT,
          kind: 'embedded_passkey',
          isPrimary: false,
        }),
      );
      await expect(service.removeWallet(user.id, embedded.id)).rejects.toMatchObject({
        reason: 'kind_not_supported',
      });
    });

    it('rejects removing a wallet the caller does not own (IDOR → not_found)', async () => {
      const [owner, other] = [await createUser(), await createUser()];
      const wallet = await service.bindByowWalletToUser(owner.id, PK_A, consumeOk);
      await expect(service.removeWallet(other.id, wallet.id)).rejects.toMatchObject({
        reason: 'not_found',
      });
    });

    it('throws a WalletMutationError (neutral domain error)', async () => {
      const user = await createUser();
      const primary = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      await expect(service.removeWallet(user.id, primary.id)).rejects.toBeInstanceOf(WalletMutationError);
    });
  });

  describe('UQ_wallets_primary_active', () => {
    it('rejects a second live primary for the same user', async () => {
      const user = await createUser();
      const repo = dataSource.getRepository(Wallet);
      await repo.save(repo.create({ userId: user.id, publicKey: PK_A, kind: 'byow', isPrimary: true }));
      await expect(
        repo.save(repo.create({ userId: user.id, publicKey: PK_B, kind: 'byow', isPrimary: true })),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('keeps a pubkey sticky to its original owner even after soft-delete (no identity transfer)', async () => {
      const [userA, userB] = [await createUser(), await createUser()];
      const wallet = await service.bindByowWalletToUser(userA.id, PK_A, consumeOk);
      await dataSource.getRepository(Wallet).softDelete(wallet.id);

      // Another collector cannot claim a pubkey previously bound to someone else, even once removed.
      await expect(service.bindByowWalletToUser(userB.id, PK_A, consumeOk)).rejects.toMatchObject({
        reason: 'already_bound',
      });
      // The original owner CAN reactivate it.
      const reactivated = await service.bindByowWalletToUser(userA.id, PK_A, consumeOk);
      expect(reactivated.id).toBe(wallet.id);
      expect(reactivated.deletedAt).toBeNull();
    });
  });
});
