import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { UsersModule } from '@modules/users/users.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { WalletsService, PrimaryChangeResult } from '@modules/wallets/wallets.service';
import { WalletMutationError } from '@modules/wallets/wallet-mutation.error';
import { Wallet } from '@modules/wallets/entities/wallet.entity';
import { User } from '@modules/users/entities/user.entity';

// Valid distinct Stellar public keys (StrKey format is validated at the SEP-10 layer, bypassed here).
const PK_A = 'GBUQ7WSGI3RHBWH7YU3ZTAXVUQGAXCGRQ3OFLWRED6RGQR57DMJP5TMI';
const PK_B = 'GA7SBPJMINSLHQYBYPOU7D3OKVZ22I36IRYFJDKUEUWRKJ5NVVIZPEH5';
const PK_C = 'GARY3E4YTQRAREQTESGLUY5TZ4O5FKKLZFVSWIDHPGQSRXPPK5WCDURR';
const CONTRACT = 'GDEXNC3EDWMNOVZY5OC6HJXKPJYZZC2MGPWNLITHXYGGZKFAEFKW2HVP'; // embedded contract-address stand-in

const consumeOk = () => Promise.resolve(true);
/** No-op audit callback (audit wiring is covered by the me-wallets unit spec). */
const noopChange = () => Promise.resolve();

/**
 * TOV-25 — primary settlement wallet: WalletsService.setPrimaryWallet + removeWallet auto-promote.
 * Exercised at the neutral-service level (like the TOV-24 bind/remove suite) against the real DB, so the
 * partial unique index `UQ_wallets_primary_active` and the optimistic contention retry are real.
 */
describe('WalletsService primary settlement wallet Integration (TOV-25)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: WalletsService;

  /** Typed raw-SQL helper (matches the export-constraints suite convention). */
  async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
    return await dataSource.query(text, params);
  }
  const createUser = () => dataSource.getRepository(User).save(dataSource.getRepository(User).create({}));
  const walletCount = (where: object) => dataSource.getRepository(Wallet).count({ where });
  const livePrimaryCount = (userId: string) => walletCount({ userId, isPrimary: true });
  const reload = (id: string) =>
    dataSource.getRepository(Wallet).findOne({ where: { id }, withDeleted: true });

  /** Seed a wallet row directly (bypasses the bind flow) — for embedded/exported/zero-primary fixtures. */
  const seedWallet = (overrides: Partial<Wallet>) =>
    dataSource.getRepository(Wallet).save(
      dataSource.getRepository(Wallet).create({
        publicKey: null,
        contractAddress: null,
        kind: 'byow',
        status: 'active',
        isPrimary: false,
        ...overrides,
      }),
    );

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

  describe('setPrimaryWallet', () => {
    it('flips the primary between two byow wallets and keeps exactly one primary', async () => {
      const user = await createUser();
      const w1 = await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // primary
      const w2 = await service.bindByowWalletToUser(user.id, PK_B, consumeOk); // non-primary

      const onChange = vi.fn(noopChange);
      const result = await service.setPrimaryWallet(user.id, w2.id, onChange);

      expect(result.isPrimary).toBe(true);
      expect((await reload(w1.id))?.isPrimary).toBe(false);
      expect((await reload(w2.id))?.isPrimary).toBe(true);
      expect(await livePrimaryCount(user.id)).toBe(1);
      expect(onChange).toHaveBeenCalledWith(
        { changed: true, previousWalletId: w1.id },
        expect.anything(),
      );
    });

    it('is an idempotent no-op when the target is already primary (changed=false)', async () => {
      const user = await createUser();
      const w1 = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);

      const onChange = vi.fn(noopChange);
      const result = await service.setPrimaryWallet(user.id, w1.id, onChange);

      expect(result.isPrimary).toBe(true);
      expect(await livePrimaryCount(user.id)).toBe(1);
      expect(onChange).toHaveBeenCalledWith(
        { changed: false, previousWalletId: null }, // no-op: nothing demoted
        expect.anything(),
      );
    });

    it('rejects a wallet not owned by the caller (IDOR → not_found)', async () => {
      const [owner, other] = [await createUser(), await createUser()];
      const w = await service.bindByowWalletToUser(owner.id, PK_A, consumeOk);
      await expect(service.setPrimaryWallet(other.id, w.id, noopChange)).rejects.toMatchObject({
        reason: 'not_found',
      });
    });

    it('rejects a soft-deleted wallet (not_found)', async () => {
      const user = await createUser();
      await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // keep a primary
      const w2 = await service.bindByowWalletToUser(user.id, PK_B, consumeOk);
      await dataSource.getRepository(Wallet).softDelete(w2.id);
      await expect(service.setPrimaryWallet(user.id, w2.id, noopChange)).rejects.toMatchObject({
        reason: 'not_found',
      });
    });

    it('rejects an exported wallet (not_eligible_for_primary)', async () => {
      const user = await createUser();
      await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // primary byow
      const exported = await seedWallet({
        userId: user.id,
        contractAddress: CONTRACT,
        kind: 'embedded_passkey',
        status: 'exported',
        removedAt: new Date(),
      });
      await expect(service.setPrimaryWallet(user.id, exported.id, noopChange)).rejects.toMatchObject({
        reason: 'not_eligible_for_primary',
      });
    });

    it('rejects an active embedded wallet (kind_not_supported)', async () => {
      const user = await createUser();
      await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      const embedded = await seedWallet({
        userId: user.id,
        contractAddress: CONTRACT,
        kind: 'embedded_passkey',
      });
      await expect(service.setPrimaryWallet(user.id, embedded.id, noopChange)).rejects.toMatchObject({
        reason: 'kind_not_supported',
      });
    });

    it('self-heals the invariant: promotes a target when the user has zero live primary', async () => {
      const user = await createUser();
      const w1 = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      // Break the invariant: no live primary at all.
      await dataSource.getRepository(Wallet).update(w1.id, { isPrimary: false });
      expect(await livePrimaryCount(user.id)).toBe(0);

      const result = await service.setPrimaryWallet(user.id, w1.id, noopChange);
      expect(result.isPrimary).toBe(true);
      expect(await livePrimaryCount(user.id)).toBe(1);
    });

    it('audit + swap are atomic: a throwing onChange rolls BOTH back', async () => {
      const user = await createUser();
      const w1 = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      const w2 = await service.bindByowWalletToUser(user.id, PK_B, consumeOk);

      // onChange writes an audit row via the SAME manager, then throws → the whole tx must roll back.
      const boom = (_result: PrimaryChangeResult, manager: EntityManager) =>
        manager
          .query(
            `INSERT INTO internal_audit_log (actor_type, actor_id, kind, subject_type, subject_id)
             VALUES ('user', $1, 'wallet.primary.changed', 'wallet', $2)`,
            [user.id, w2.id],
          )
          .then(() => {
            throw new Error('boom after audit write');
          });

      await expect(service.setPrimaryWallet(user.id, w2.id, boom)).rejects.toThrow('boom');

      // State unchanged: w1 still primary, w2 not, and NO audit row survived.
      expect((await reload(w1.id))?.isPrimary).toBe(true);
      expect((await reload(w2.id))?.isPrimary).toBe(false);
      const rows = await q<{ count: number }>(
        `SELECT count(*)::int AS count FROM internal_audit_log WHERE subject_id = $1`,
        [w2.id],
      );
      expect(rows[0].count).toBe(0);
    });

    it('holds the single-primary invariant under concurrent set-primary (set vs set)', async () => {
      const user = await createUser();
      await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      const w2 = await service.bindByowWalletToUser(user.id, PK_B, consumeOk);
      const w3 = await service.bindByowWalletToUser(user.id, PK_C, consumeOk);

      // Two concurrent swaps to different targets — both resolve, exactly one primary remains.
      await Promise.all([
        service.setPrimaryWallet(user.id, w2.id, noopChange),
        service.setPrimaryWallet(user.id, w3.id, noopChange),
      ]);
      expect(await livePrimaryCount(user.id)).toBe(1);
    });

    it('holds the invariant under set-primary racing a concurrent bind (set vs insert) — no 500', async () => {
      const user = await createUser();
      await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // primary
      const w2 = await service.bindByowWalletToUser(user.id, PK_B, consumeOk);

      // set-primary(W2) concurrent with binding a brand-new wallet PK_C: the demote-retry absorbs the race.
      await Promise.all([
        service.setPrimaryWallet(user.id, w2.id, noopChange),
        service.bindByowWalletToUser(user.id, PK_C, consumeOk),
      ]);
      expect(await livePrimaryCount(user.id)).toBe(1);
      expect(await walletCount({ userId: user.id })).toBe(3);
    });
  });

  describe('removeWallet auto-promote', () => {
    it('promotes the oldest eligible byow sibling and soft-deletes the primary', async () => {
      const user = await createUser();
      const w1 = await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // primary (oldest)
      const w2 = await service.bindByowWalletToUser(user.id, PK_B, consumeOk); // oldest sibling
      const w3 = await service.bindByowWalletToUser(user.id, PK_C, consumeOk); // newer sibling

      const onReassigned = vi.fn(() => Promise.resolve());
      await service.removeWallet(user.id, w1.id, onReassigned);

      expect((await reload(w1.id))?.deletedAt).not.toBeNull();
      expect((await reload(w2.id))?.isPrimary).toBe(true); // oldest sibling promoted
      expect((await reload(w3.id))?.isPrimary).toBe(false);
      expect(await livePrimaryCount(user.id)).toBe(1);
      expect(await walletCount({ userId: user.id })).toBe(2); // live rows
      expect(onReassigned).toHaveBeenCalledWith(
        { previousWalletId: w1.id, newWalletId: w2.id },
        expect.anything(),
      );
    });

    it('refuses when the only sibling is an embedded wallet (no eligible promotion)', async () => {
      const user = await createUser();
      const primary = await service.bindByowWalletToUser(user.id, PK_A, consumeOk);
      await seedWallet({ userId: user.id, contractAddress: CONTRACT, kind: 'embedded_passkey' });

      await expect(service.removeWallet(user.id, primary.id)).rejects.toMatchObject({
        reason: 'primary_cannot_be_removed',
      });
      expect((await reload(primary.id))?.deletedAt).toBeNull(); // untouched
    });

    it('soft-unbind of a non-primary keeps status=active and removed_at NULL (no CHECK violation)', async () => {
      const user = await createUser();
      await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // primary
      const w2 = await service.bindByowWalletToUser(user.id, PK_B, consumeOk);

      await service.removeWallet(user.id, w2.id);
      const gone = await reload(w2.id);
      expect(gone?.deletedAt).not.toBeNull();
      expect(gone?.status).toBe('active');
      expect(gone?.removedAt).toBeNull();
    });
  });

  // TOV-25 #159: prove the delete-vs-promote races are safe (the invariant holds, and no raw 500 leaks).
  // A data-integrity review flagged a possible 23505→500 on the sibling promote; these tests assert the
  // per-attempt re-read in runWithPrimaryContention absorbs it. `rejectionsAreDomainErrors` guards the "no
  // raw 500" property; `assertInvariant` guards "≥1 live wallet ⇒ exactly one primary".
  describe('removeWallet auto-promote — concurrency (TOV-25 #159)', () => {
    const rejectionsAreDomainErrors = (results: PromiseSettledResult<unknown>[]) =>
      results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .forEach((r) => expect(r.reason).toBeInstanceOf(WalletMutationError));

    const assertInvariant = async (userId: string) => {
      const live = await walletCount({ userId });
      const primaries = await livePrimaryCount(userId);
      expect(primaries).toBe(live > 0 ? 1 : 0);
    };

    it('delete-primary racing set-primary(other) → one primary, no 500', async () => {
      const user = await createUser();
      const p = await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // primary
      await service.bindByowWalletToUser(user.id, PK_B, consumeOk); // sibling
      const t = await service.bindByowWalletToUser(user.id, PK_C, consumeOk); // third

      const results = await Promise.allSettled([
        service.removeWallet(user.id, p.id),
        service.setPrimaryWallet(user.id, t.id, noopChange),
      ]);
      rejectionsAreDomainErrors(results);
      await assertInvariant(user.id);
    });

    it('delete-primary racing delete-sibling → invariant holds, refusals are domain errors', async () => {
      const user = await createUser();
      const p = await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // primary
      const s = await service.bindByowWalletToUser(user.id, PK_B, consumeOk); // sibling

      const results = await Promise.allSettled([
        service.removeWallet(user.id, p.id),
        service.removeWallet(user.id, s.id),
      ]);
      rejectionsAreDomainErrors(results); // any refusal is primary_cannot_be_removed, never a raw 500
      await assertInvariant(user.id);
    });

    it('double delete of the same primary → invariant holds (a benign 2nd auto_promote callback is possible)', async () => {
      const user = await createUser();
      const p = await service.bindByowWalletToUser(user.id, PK_A, consumeOk); // primary
      const s = await service.bindByowWalletToUser(user.id, PK_B, consumeOk); // sibling

      // The reassign callback stands in for the me-surface audit write; count how often it fires. A concurrent
      // double-delete can promote the sibling twice (idempotent), so the callback may run 1-2 times.
      const reassign = vi.fn(() => Promise.resolve());
      const results = await Promise.allSettled([
        service.removeWallet(user.id, p.id, reassign),
        service.removeWallet(user.id, p.id, reassign),
      ]);
      rejectionsAreDomainErrors(results);
      await assertInvariant(user.id);
      expect((await reload(s.id))?.isPrimary).toBe(true); // sibling ends up primary
      expect(reassign.mock.calls.length).toBeGreaterThanOrEqual(1); // ≥1; may be 2 under the race (benign)
    });
  });
});
