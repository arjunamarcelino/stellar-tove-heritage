import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { UsersService } from '@modules/users/users.service';
import { User } from '@modules/users/entities/user.entity';
import { Wallet } from './entities/wallet.entity';
import { PasskeyCredential } from './entities/passkey-credential.entity';
import { WalletBindError } from './wallet-bind.error';
import { WalletMutationError } from './wallet-mutation.error';
import { EmbeddedWalletNotFoundError } from './embedded-wallet-not-found.error';
import {
  WALLET_REPOSITORY,
  IWalletRepository,
} from './repositories/wallet-repository.interface';
import {
  PASSKEY_CREDENTIAL_REPOSITORY,
  IPasskeyCredentialRepository,
} from './repositories/passkey-credential-repository.interface';
import { AuditLogService } from './audit/audit-log.service';
import { AUDIT_KIND } from './audit/audit-log.types';

export interface EmbeddedPasskeyWalletInput {
  email: string;
  contractAddress: string;
  credential: { id: string; publicKey: Buffer; counter: number; transports?: string[] };
}

/**
 * The caller's embedded-passkey wallet resolved for a transfer (TOV-22): the smart-wallet contract
 * address (the transfer `from`) plus its bound passkey credential. `publicKey` is the stored COSE
 * key (decode to a raw P-256 point via `cose.helper` when verifying a signature); `credentialId` +
 * `transports` let the frontend scope `navigator.credentials.get`.
 */
export interface EmbeddedWalletResolution {
  contractAddress: string;
  credential: { credentialId: string; transports: string | null; publicKey: Buffer };
}

/**
 * Outcome of a {@link WalletsService.setPrimaryWallet} attempt, handed to the caller's in-tx audit callback.
 * `changed` is false for an idempotent no-op (target already primary) — the caller then writes NO audit row.
 * `previousWalletId` is the demoted wallet id, or null when there was no prior primary (or on a no-op).
 */
export interface PrimaryChangeResult {
  changed: boolean;
  previousWalletId: string | null;
}

/** A primary reassignment performed by {@link WalletsService.removeWallet} auto-promotion, for the audit row. */
export interface PrimaryReassignment {
  previousWalletId: string;
  newWalletId: string;
}

/**
 * Outcome of {@link WalletsService.removeWallet}. `promotedWalletId` is the sibling auto-promoted to primary
 * when the deleted wallet was primary, or null when no promotion happened (a non-primary wallet was removed).
 */
export interface RemoveWalletResult {
  promotedWalletId: string | null;
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @Inject(WALLET_REPOSITORY) private readonly walletRepo: IWalletRepository,
    @Inject(PASSKEY_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IPasskeyCredentialRepository,
    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Record the first-time primary designation of a wallet (genesis at account creation, add-path self-heal,
   * or reactivation-to-primary), inside the caller's transaction so the audit fact is atomic with the write.
   * `reason: 'initial'` distinguishes it from the `user`/`auto_promote` changes on the me/ surface. (TOV-25 #166)
   */
  private recordPrimaryDesignated(
    manager: EntityManager,
    userId: string,
    walletId: string,
  ): Promise<void> {
    return this.audit.record(
      {
        actorType: 'user',
        actorId: userId,
        kind: AUDIT_KIND.PRIMARY_CHANGED,
        subjectType: 'wallet',
        subjectId: walletId,
        payload: { previousWalletId: null, newWalletId: walletId, reason: 'initial' },
      },
      manager,
    );
  }

  /**
   * Resolve the User bound to a verified wallet, creating a wallet-only User +
   * wallet atomically on first sight. The user + wallet insert share one
   * transaction so a failed wallet insert never leaves an orphan user; a
   * concurrent first-login (unique-key race on public_key) falls back to a
   * re-read of the winning row.
   */
  async findOrCreateForWallet(publicKey: string): Promise<{ user: User; wallet: Wallet }> {
    const existing = await this.walletRepo.findByPublicKey(publicKey);
    if (existing) {
      return { user: existing.user, wallet: existing };
    }

    // Reactivate a previously soft-deleted wallet rather than forking a new user
    // for the same public key (which would orphan the original user's data and
    // bypass whatever the soft-delete meant). No active row exists here, so the
    // partial-unique index permits clearing deleted_at. is_primary is RECOMPUTED
    // (never trust the stale flag) — see reactivateWalletForUser.
    const softDeleted = await this.walletRepo.findAnyByPublicKey(publicKey);
    if (softDeleted) {
      const wallet = await this.reactivateWalletForUser(softDeleted.user.id, softDeleted);
      this.logger.log(`Reactivated soft-deleted BYOW wallet [user=${softDeleted.user.id}]`);
      return { user: softDeleted.user, wallet };
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        // Users domain owns User construction; same manager keeps it atomic here.
        const user = await this.usersService.createWalletUser(manager);

        // First wallet of a brand-new user → primary (TOV-24 invariant: ≥1 live ⇒ exactly one primary).
        const wallet = manager.create(Wallet, { userId: user.id, publicKey, kind: 'byow', isPrimary: true });
        await manager.save(wallet);
        await this.recordPrimaryDesignated(manager, user.id, wallet.id); // genesis primary (#166)

        this.logger.log(`BYOW wallet bound to new user [user=${user.id}]`);
        return { user, wallet };
      });
    } catch (err) {
      // Concurrent first-login: another request won the public_key unique index.
      if (isUniqueConstraintError(err)) {
        const winner = await this.walletRepo.findByPublicKey(publicKey);
        if (winner) {
          return { user: winner.user, wallet: winner };
        }
      }
      throw err;
    }
  }

  /**
   * Bind an already-SEP-10-verified BYOW public key to an EXISTING authenticated user (TOV-24). Unlike
   * {@link findOrCreateForWallet} (login: mints a user per key), this attaches the key to `userId`.
   *
   * `consume` (the tx-scoped SEP-10 challenge consume) runs INSIDE the write transaction, so a rolled-back
   * bind leaves the challenge live/retryable — no consume-then-fail replay gap (mirrors
   * {@link createEmbeddedPasskeyWallet}). The user's first live wallet becomes primary. Idempotent for the
   * same owner's already-bound key; reactivates a soft-deleted own row (recomputing `is_primary`, never
   * trusting the stale flag); rejects a key owned by another collector.
   */
  async bindByowWalletToUser(
    userId: string,
    publicKey: string,
    consume: (manager: EntityManager) => Promise<boolean>,
  ): Promise<Wallet> {
    try {
      // The primary-index demote-retry is owned by the shared helper; `allowPrimary` is its race flag.
      return await this.runWithPrimaryContention(async (manager, allowPrimary) => {
        // Consume in-tx first: a later failure rolls this back, keeping the challenge retryable.
        if (!(await consume(manager))) {
          throw new WalletMutationError('challenge_consumed');
        }
        const repo = manager.getRepository(Wallet);
        // Deterministic ownership resolution — a pubkey has ≤1 LIVE row (partial unique index) but can
        // have several soft-deleted rows. Any row (live or soft-deleted) owned by ANOTHER collector makes
        // the pubkey sticky → 409 (identity does not transfer on re-add). Scoping the reads by userId
        // avoids depending on an arbitrary `findOne` row when several rows share the pubkey.
        const foreign = await repo.findOne({
          where: { publicKey, userId: Not(userId) },
          withDeleted: true,
        });
        if (foreign) throw new WalletMutationError('already_bound');
        // Any remaining row for this pubkey belongs to the caller.
        const own = await repo.findOne({ where: { publicKey, userId }, withDeleted: true });
        if (own && !own.deletedAt) return own; // same owner, already live → idempotent no-op
        // Become primary iff the user currently has NO live primary (self-healing: also restores the
        // "≥1 live ⇒ exactly one primary" invariant if it was somehow broken). `allowPrimary` is the
        // concurrent-race demote flag.
        const hasLivePrimary = (await repo.count({ where: { userId, isPrimary: true } })) > 0;
        const isPrimary = allowPrimary && !hasLivePrimary;
        if (own) {
          // Same owner, soft-deleted → reactivate + normalize in one UPDATE (recover() only clears
          // deleted_at, so a frozen is_primary=true could transiently collide with a live primary).
          return this.reactivateRow(manager, own, isPrimary);
        }
        const wallet = repo.create({ userId, publicKey, kind: 'byow', isPrimary });
        await repo.save(wallet);
        if (isPrimary) await this.recordPrimaryDesignated(manager, userId, wallet.id); // self-heal genesis (#166)
        return wallet;
      });
    } catch (err) {
      if (err instanceof WalletMutationError) throw err;
      // The LIVE-pubkey unique slot must be resolved OUTSIDE the tx (the aborted tx can't be reused): our
      // own concurrent add returns the winner; anyone else's (or a since-removed winner) is the sticky 409.
      // A primary-index collision is handled (retried) inside the helper, so it never reaches here.
      if (isUniqueConstraintError(err) && this.constraintName(err) === 'UQ_wallets_public_key_active') {
        const winner = await this.walletRepo.findByPublicKey(publicKey);
        if (winner && winner.userId === userId) return winner;
        throw new WalletMutationError('already_bound');
      }
      throw err;
    }
  }

  /**
   * Set an owned BYOW wallet as the caller's primary settlement wallet (TOV-25, FR-01.04). Owner-scoped
   * (404 on a non-owned/soft-deleted id — IDOR guard); rejects exported (409) and embedded (422) wallets;
   * re-setting the current primary is an idempotent no-op (`changed=false`, no audit). Runs under the shared
   * optimistic contention (demote current → guarded-promote target; a lost `UQ_wallets_primary_active` race
   * is retried once). `onChange` (the audit write, supplied by the me-surface) runs INSIDE the transaction so
   * the audit row commits/rolls back atomically with the swap.
   */
  async setPrimaryWallet(
    userId: string,
    walletId: string,
    onChange: (result: PrimaryChangeResult, manager: EntityManager) => Promise<void>,
  ): Promise<Wallet> {
    // Ignores the helper's `allowPrimary` flag by design: set-primary always wants the target primary, so
    // there is no "restore as non-primary" fallback. Correctness comes from re-reading `current` each attempt
    // + demote-before-promote + the guarded promote, not from the flag (unlike bind/reactivate).
    return this.runWithPrimaryContention(async (manager) => {
      const repo = manager.getRepository(Wallet);
      const target = await repo.findOne({ where: { id: walletId, userId } }); // live only (excludes soft-deleted)
      if (!target) throw new WalletMutationError('not_found');
      // Eligibility (status BEFORE kind, deliberately). Today `status='exported' ⟹ kind='embedded_passkey'`
      // (only the embedded drain exports), so the kind check alone would already reject every exported
      // wallet as 422. We keep the distinct `not_eligible_for_primary` (409) as a FORWARD-GUARD: if a BYOW
      // wallet ever becomes exportable, an exported BYOW must be refused as 409 (not eligible), not 422
      // (wrong-kind). Ordering status first makes exported→409 and active-embedded→422 both hold. (TOV-25 #163)
      if (target.status !== 'active') throw new WalletMutationError('not_eligible_for_primary'); // exported
      if (target.kind !== 'byow') throw new WalletMutationError('kind_not_supported'); // active embedded
      if (target.isPrimary) {
        // Idempotent no-op → no audit row. `previousWalletId` is null (nothing was demoted).
        await onChange({ changed: false, previousWalletId: null }, manager);
        return target;
      }
      const current = await repo.findOne({ where: { userId, isPrimary: true } }); // re-read every attempt
      if (current) await repo.update(current.id, { isPrimary: false }); // demote FIRST (self-collision safety)
      // Guarded promote: only a still-live+active row flips. A concurrent delete/export between the read and
      // here → affected 0 → the whole tx rolls back and we surface the precise error.
      const promoted = await repo.update(
        { id: target.id, deletedAt: IsNull(), status: 'active' },
        { isPrimary: true },
      );
      if ((promoted.affected ?? 0) === 0) {
        const fresh = await repo.findOne({ where: { id: walletId, userId } });
        throw new WalletMutationError(fresh ? 'not_eligible_for_primary' : 'not_found');
      }
      target.isPrimary = true;
      await onChange({ changed: true, previousWalletId: current?.id ?? null }, manager);
      return target;
    });
  }

  /**
   * Soft-unbind a wallet the caller owns (TOV-24 + TOV-25 auto-promote). Owner-scoped (404 on a non-owned id
   * — IDOR guard); embedded wallets are offboarded via export, not removal (422). When the target is the
   * primary wallet, the oldest eligible sibling (live, active, byow) is auto-promoted and the target removed;
   * only when NO eligible sibling exists is the delete refused (409 `primary_cannot_be_removed`, covering the
   * sole-wallet and only-embedded-sibling cases).
   *
   * Runs under the shared optimistic contention: demote target → guarded-promote sibling → soft-delete
   * target, all in one transaction (atomic; a lost `UQ_wallets_primary_active` race is retried once). No row
   * lock — the partial unique index + retry is the codebase's primary-concurrency strategy. `onPrimaryReassigned`
   * (the audit write) runs INSIDE the tx so the audit row is atomic with the promotion.
   */
  async removeWallet(
    userId: string,
    walletId: string,
    onPrimaryReassigned?: (result: PrimaryReassignment, manager: EntityManager) => Promise<void>,
  ): Promise<RemoveWalletResult> {
    return this.runWithPrimaryContention(async (manager) => {
      const repo = manager.getRepository(Wallet);
      const wallet = await repo.findOne({ where: { id: walletId, userId } }); // live only
      if (!wallet) throw new WalletMutationError('not_found');
      if (wallet.kind !== 'byow') throw new WalletMutationError('kind_not_supported'); // embedded → export, not delete
      if (!wallet.isPrimary) {
        await repo.softDelete(walletId); // non-primary: plain soft-unbind
        return { promotedWalletId: null };
      }
      // Primary: promote the oldest eligible sibling, then soft-delete the target.
      const sibling = await repo.findOne({
        where: { userId, kind: 'byow', status: 'active', id: Not(walletId) },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      if (!sibling) throw new WalletMutationError('primary_cannot_be_removed'); // sole wallet / only embedded siblings
      await repo.update(walletId, { isPrimary: false }); // demote FIRST (avoid a transient 2-primary collision)
      // Guarded promote: if the chosen sibling was concurrently deleted between read and here (affected 0),
      // roll back and refuse rather than promote a dead row (an extreme race; the client retry re-resolves).
      const promoted = await repo.update(
        { id: sibling.id, deletedAt: IsNull(), status: 'active' },
        { isPrimary: true },
      );
      if ((promoted.affected ?? 0) === 0) throw new WalletMutationError('primary_cannot_be_removed');
      await repo.softDelete(walletId); // then soft-unbind (same tx ⇒ atomic with demote + promote)
      if (onPrimaryReassigned) {
        await onPrimaryReassigned({ previousWalletId: walletId, newWalletId: sibling.id }, manager);
      }
      return { promotedWalletId: sibling.id };
    });
  }

  /** Look up a passkey credential by its WebAuthn id (with wallet + user loaded). */
  async findByCredentialId(credentialId: string): Promise<PasskeyCredential | null> {
    return this.credentialRepo.findByCredentialId(credentialId);
  }

  /** All LIVE wallets owned by a user, for the `GET /me/wallets` list (TOV-40 stopgap; TOV-24 owns it). */
  async listOwnedWallets(userId: string): Promise<Wallet[]> {
    return this.walletRepo.findAllByUserId(userId);
  }

  /**
   * A LIVE wallet owned by `userId` (any kind/status), for the export owner-scope guard (TOV-40).
   * Null ⇒ not found / not owned (the caller maps that to WALLET_NOT_FOUND); a byow / already-exported
   * wallet is returned so the caller can distinguish it (→ EXPORT_NOT_AVAILABLE), not a misleading 404.
   */
  async findOwnedWallet(userId: string, walletId: string): Promise<Wallet | null> {
    return this.walletRepo.findOwnedById(walletId, userId);
  }

  /** The passkey credential bound to a wallet (1:1), or null (a data anomaly for an embedded wallet). */
  async getWalletCredential(walletId: string): Promise<PasskeyCredential | null> {
    return this.credentialRepo.findByWalletId(walletId);
  }

  /** Flip a wallet to the terminal `exported` state within the caller's transaction (TOV-40). */
  async markWalletExported(walletId: string, manager: EntityManager): Promise<boolean> {
    return this.walletRepo.markExported(walletId, manager);
  }

  /**
   * Resolve the caller's live embedded-passkey wallet + bound credential for a transfer (TOV-22).
   * Owner-scoped: the `from` wallet is derived from the authenticated user id, never from the
   * request. Throws {@link EmbeddedWalletNotFoundError} when the caller has no live embedded wallet
   * (byow-only, soft-deleted, or a data anomaly with a missing/absent contract address / credential).
   */
  async resolveEmbeddedWalletForUser(userId: string): Promise<EmbeddedWalletResolution> {
    const wallet = await this.walletRepo.findEmbeddedWalletByUserId(userId);
    if (!wallet || !wallet.contractAddress) {
      throw new EmbeddedWalletNotFoundError(userId);
    }
    const credential = await this.credentialRepo.findByWalletId(wallet.id);
    if (!credential) {
      // A passkey wallet must carry its bound credential; absence is a data anomaly, not a 500.
      this.logger.warn(`embedded wallet has no bound credential [wallet=${wallet.id}]`);
      throw new EmbeddedWalletNotFoundError(userId);
    }
    return {
      contractAddress: wallet.contractAddress,
      credential: {
        credentialId: credential.credentialId,
        transports: credential.transports,
        publicKey: credential.publicKey,
      },
    };
  }

  /**
   * Atomically create the embedded-passkey wallet aggregate: consume the challenge
   * (auth-owned callback), create the passkey User, and bind the Wallet + its
   * PasskeyCredential in one transaction. The deploy has already happened; a rolled
   * back tx leaves the challenge live/retryable and the contract self-heals on retry.
   */
  async createEmbeddedPasskeyWallet(
    input: EmbeddedPasskeyWalletInput,
    consume: (manager: EntityManager) => Promise<boolean>,
  ): Promise<{ user: User; wallet: Wallet }> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const consumed = await consume(manager);
        if (!consumed) {
          throw new WalletBindError('challenge_consumed');
        }

        const user = await this.usersService.createPasskeyUser(manager, input.email);

        const wallet = manager.create(Wallet, {
          userId: user.id,
          publicKey: null,
          contractAddress: input.contractAddress,
          kind: 'embedded_passkey',
          // First wallet of a brand-new user → primary (TOV-24 invariant).
          isPrimary: true,
        });
        await manager.save(wallet);

        const credential = manager.create(PasskeyCredential, {
          walletId: wallet.id,
          credentialId: input.credential.id,
          publicKey: input.credential.publicKey,
          counter: input.credential.counter,
          transports: input.credential.transports?.join(',') ?? null,
        });
        await manager.save(credential);
        await this.recordPrimaryDesignated(manager, user.id, wallet.id); // genesis primary (#166)

        this.logger.log(`Embedded passkey wallet bound to new user [user=${user.id}]`);
        return { user, wallet };
      });
    } catch (err) {
      if (err instanceof WalletBindError) throw err;
      if (isUniqueConstraintError(err)) {
        const constraint = this.constraintName(err);
        // credential_id or contract_address collision -> the passkey/wallet is already bound.
        if (constraint.includes('credential_id') || constraint.includes('contract_address')) {
          throw new WalletBindError('passkey_already_bound');
        }
        // users email raced between the pre-check and commit.
        if (constraint.includes('email')) {
          throw new WalletBindError('email_conflict');
        }
        // Unknown unique violation -- don't mislabel it; rethrow the raw error.
      }
      throw err;
    }
  }

  /**
   * Reactivate a soft-deleted wallet for its owner, RECOMPUTING `is_primary` inside a transaction so a
   * stale `is_primary=true` frozen at delete time cannot resurrect a second live primary (which would
   * violate `UQ_wallets_primary_active` and 500 the caller). Demotes + retries once on a `primary`
   * collision. Same normalization `bindByowWalletToUser` performs inline for the add flow — extracted so
   * the login path (`findOrCreateForWallet`) can no longer diverge from it.
   */
  private async reactivateWalletForUser(userId: string, wallet: Wallet): Promise<Wallet> {
    return this.runWithPrimaryContention(async (manager, allowPrimary) => {
      const hasLivePrimary =
        (await manager.getRepository(Wallet).count({ where: { userId, isPrimary: true } })) > 0;
      return this.reactivateRow(manager, wallet, allowPrimary && !hasLivePrimary);
    });
  }

  /**
   * Run a primary-mutating write under the codebase's single primary-concurrency strategy: attempt the write
   * in a transaction, and if it loses the `UQ_wallets_primary_active` race (23505 on that exact index), retry
   * ONCE with `allowPrimary=false` (the demote-retry). Any other error — including any other unique violation
   * — propagates for the caller to resolve. Shared by bind, reactivate, set-primary, and remove so there is
   * exactly ONE concurrency discipline, index-enforced and lock-free (no `FOR UPDATE`, no deadlock).
   *
   * CONTRACT (enforced by convention, not the compiler):
   * - `fn` MUST re-read all state each attempt — the second attempt sees a committed concurrent primary, so
   *   caching a row read outside `fn` would reintroduce a race.
   * - `fn` runs INSIDE the transaction with wallet row locks held until commit; keep it CHEAP. Any audit
   *   callback it invokes must be a single in-tx write — no HTTP/queue/extra-query I/O, which would extend
   *   the lock-hold window on the primary rows.
   * - `allowPrimary` is honored by bind/reactivate (they fall back to non-primary on the retry); set-primary
   *   and remove ignore it (they re-read + demote-first + guarded-promote instead).
   */
  private async runWithPrimaryContention<T>(
    fn: (manager: EntityManager, allowPrimary: boolean) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.dataSource.transaction((manager) => fn(manager, attempt === 0));
      } catch (err) {
        if (
          isUniqueConstraintError(err) &&
          this.constraintName(err) === 'UQ_wallets_primary_active' &&
          attempt === 0
        ) {
          continue; // lost the primary race → retry once with allowPrimary=false
        }
        throw err;
      }
    }
    // Unreachable: attempt 1 uses allowPrimary=false, which cannot collide on the primary index.
    throw new Error('primary contention retry exhausted');
  }

  /**
   * Single-statement reactivation: clears `deleted_at` AND sets `is_primary`/`status`/`removed_at`
   * together, so a stale `is_primary=true` frozen at soft-delete time can never transiently collide with a
   * live primary (unlike `recover()`, which only touches the delete column). Mutates the in-memory entity
   * to match and returns it.
   */
  private async reactivateRow(
    manager: EntityManager,
    wallet: Wallet,
    isPrimary: boolean,
  ): Promise<Wallet> {
    await manager
      .getRepository(Wallet)
      .update(wallet.id, { isPrimary, status: 'active', removedAt: null, deletedAt: null });
    wallet.isPrimary = isPrimary;
    wallet.status = 'active';
    wallet.removedAt = null;
    wallet.deletedAt = null;
    if (isPrimary) await this.recordPrimaryDesignated(manager, wallet.userId, wallet.id); // reactivated to primary (#166)
    return wallet;
  }

  private constraintName(err: unknown): string {
    if (typeof err === 'object' && err !== null && 'constraint' in err) {
      const constraint = (err as { constraint?: unknown }).constraint;
      return typeof constraint === 'string' ? constraint : '';
    }
    return '';
  }
}
