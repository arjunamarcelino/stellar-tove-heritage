import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { Quote } from '../entities/quote.entity';
import type { QuoteStatus } from '../constants/quote-status.constant';
import {
  AuthorizeQuotePatch,
  IQuoteRepository,
  NewQuote,
  OpenQuoteRow,
  QuoteIdempotencyKey,
} from './quote-repository.interface';

// Status literals bound as typed params so a typo is a compile error, not a silently-never-matching filter.
const Q_OPEN: QuoteStatus = 'open';
const Q_EXPIRED: QuoteStatus = 'expired';
const Q_ACCEPTED: QuoteStatus = 'accepted';
const Q_SUPERSEDED: QuoteStatus = 'superseded';

@Injectable()
export class QuoteRepository extends BaseRepository<Quote> implements IQuoteRepository {
  constructor(dataSource: DataSource) {
    super(Quote, dataSource);
  }

  async insertOpen(manager: EntityManager, quote: NewQuote): Promise<Quote | null> {
    // ON CONFLICT DO NOTHING (NOT a caught 23505 — that aborts the surrounding txn). The conflict target is
    // pinned to UQ_quotes_idem's columns so ONLY an idempotency-key collision maps to the replay path; the
    // active-per-RFQ slot is enforced authoritatively by hasOpenQuoteForRfq under the advisory lock, before
    // this insert. 0 rows → null → the service replays the existing quote (idempotent submit).
    // Single round-trip: RETURNING * hydrates server defaults/timestamps (mapped to entity fields via
    // generatedMaps) — no follow-up SELECT inside the advisory lock (TOV-175 #373).
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(Quote)
      .values({ ...quote, status: Q_OPEN })
      .orIgnore('("holder_sub", "rfq_id", "idempotency_key_hash")')
      .returning('*')
      .execute();
    // On an ON-CONFLICT DO NOTHING, `raw` is empty (generatedMaps is [{}], NOT [] — don't gate on it).
    if ((result.raw as unknown[]).length === 0) {
      return null;
    }
    return result.generatedMaps[0] as Quote;
  }

  async hasOpenQuoteForRfq(
    rfqId: string,
    holderSub: string,
    opts?: { manager?: EntityManager; excludeLapsed?: boolean },
  ): Promise<boolean> {
    // Matches the UQ_quotes_active_per_rfq partial predicate (status='open' AND deleted_at IS NULL).
    // No manager → default connection (cheap pre-check); with the txn manager → authoritative under the lock.
    const qb = opts?.manager
      ? opts.manager.createQueryBuilder(Quote, 'q')
      : this.repository.createQueryBuilder('q');
    qb.select('1', 'x')
      .where('q.rfq_id = :rfqId', { rfqId })
      .andWhere('q.holder_sub = :holderSub', { holderSub })
      .andWhere('q.status = :open', { open: Q_OPEN })
      .andWhere('q.deleted_at IS NULL');
    if (opts?.excludeLapsed) {
      // Pre-lock only: a lapsed-but-unreaped own quote is NOT a real conflict (it will be reaped in-txn).
      qb.andWhere('q.valid_until > now()');
    }
    const found = await qb.limit(1).getRawOne<{ x: number }>();
    return found != null;
  }

  async sumOpenLockedCount(
    manager: EntityManager,
    holderSub: string,
    fractionContractId: string,
  ): Promise<bigint> {
    // COALESCE avoids BigInt(null) on an empty open set. valid_until > now() is a residual on the partial
    // IDX_quotes_locked (holder_sub, fraction_contract_id) WHERE status='open' AND deleted_at IS NULL.
    const row = await manager
      .createQueryBuilder(Quote, 'q')
      .select('COALESCE(SUM(q.fraction_count), 0)', 'sum')
      .where('q.holder_sub = :holderSub', { holderSub })
      .andWhere('q.fraction_contract_id = :fractionContractId', { fractionContractId })
      .andWhere('q.status = :open', { open: Q_OPEN })
      .andWhere('q.valid_until > now()')
      .andWhere('q.deleted_at IS NULL')
      .getRawOne<{ sum: string }>();
    return BigInt(row?.sum ?? '0');
  }

  async reapLapsed(
    manager: EntityManager,
    holderSub: string,
    fractionContractId: string,
  ): Promise<number> {
    // Forward-only open → expired (allowed by fn_quotes_guard). Bump updated_at (not frozen). Frees the
    // holder's own lapsed slot for a re-quote and removes the rows from IDX_quotes_locked before the sum.
    const result = await manager
      .createQueryBuilder()
      .update(Quote)
      .set({ status: Q_EXPIRED, updatedAt: () => 'now()' })
      .where(
        'holder_sub = :holderSub AND fraction_contract_id = :fractionContractId ' +
          'AND status = :open AND valid_until <= now() AND deleted_at IS NULL',
        { holderSub, fractionContractId, open: Q_OPEN },
      )
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Soft-delete is unsupported on `rfq_quotes`: `fn_quotes_guard` blocks any `deleted_at` change at the DB
   * level (a raw 500). Override to fail fast with a clear domain error so a future caller can't hit that (#378).
   */
  override softRemove(): Promise<never> {
    return Promise.reject(
      new Error('rfq_quotes rows are immutable; soft-delete is not supported (fn_quotes_guard)'),
    );
  }

  async findByIdempotency(key: QuoteIdempotencyKey): Promise<Quote | null> {
    return this.repository.findOne({
      where: {
        holderSub: key.holderSub,
        rfqId: key.rfqId,
        idempotencyKeyHash: key.idempotencyKeyHash,
      },
    });
  }

  // ── TOV-177: accept-and-settle read + seller-authorization + settlement transitions ────────────────────

  async findOpenQuotesForRfq(rfqId: string): Promise<OpenQuoteRow[]> {
    // OPEN quotes only, price ASC then created_at ASC (backend-sorted per the AC). LEFT JOIN users for the
    // pseudonymous seller handle (NULL for a wallet-only holder). `acceptable` is derived in SQL; the raw
    // seller_auth_entry / holder_sub / wallet are NEVER selected.
    return this.repository
      .createQueryBuilder('q')
      .leftJoin('users', 'u', 'u.id = q.holder_sub')
      .select('q.id', 'quoteId')
      .addSelect('u.handle', 'sellerHandle')
      .addSelect('q.fraction_count', 'fractionCount')
      .addSelect('q.price_per_fraction_stroops', 'pricePerFractionStroops')
      .addSelect('q.fraction_count * q.price_per_fraction_stroops', 'grossStroops')
      .addSelect('q.valid_until', 'validUntil')
      .addSelect('q.status', 'status')
      .addSelect(
        "(q.status = 'open' AND q.seller_auth_entry IS NOT NULL AND q.valid_until > now())",
        'acceptable',
      )
      .where('q.rfq_id = :rfqId', { rfqId })
      .andWhere('q.status = :open', { open: Q_OPEN })
      .andWhere('q.deleted_at IS NULL')
      .orderBy('q.price_per_fraction_stroops', 'ASC')
      .addOrderBy('q.created_at', 'ASC')
      .getRawMany<OpenQuoteRow>();
  }

  async markAuthorized(
    manager: EntityManager,
    quoteId: string,
    patch: AuthorizeQuotePatch,
  ): Promise<boolean> {
    // CAS on status='open' so a raced accept/cancel can't be authorized. The auth columns are absent from the
    // guard's freeze list ⇒ writable + re-authorizable; status/valid_until untouched.
    const result = await manager
      .createQueryBuilder()
      .update(Quote)
      .set({
        sellerAuthEntry: patch.entry,
        sellerAuthExpiresLedger: String(patch.expiresLedger),
        sellerWalletContract: patch.wallet,
        authorizedAt: () => 'now()',
        updatedAt: () => 'now()',
      })
      .where('id = :quoteId AND status = :open', { quoteId, open: Q_OPEN })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  async sumAuthorizedLockedCount(
    manager: EntityManager,
    holderSub: string,
    fractionContractId: string,
    opts?: { excludeQuoteId?: string },
  ): Promise<bigint> {
    // Only AUTHORIZED, open, live quotes lock balance (an un-authorized open quote can't settle). COALESCE
    // avoids BigInt(null) on an empty set. Served by IDX_quotes_locked; seller_auth_entry/valid_until residual.
    // excludeQuoteId drops the quote being re-authorized so it isn't counted against itself (#385).
    const qb = manager
      .createQueryBuilder(Quote, 'q')
      .select('COALESCE(SUM(q.fraction_count), 0)', 'sum')
      .where('q.holder_sub = :holderSub', { holderSub })
      .andWhere('q.fraction_contract_id = :fractionContractId', { fractionContractId })
      .andWhere('q.status = :open', { open: Q_OPEN })
      .andWhere('q.seller_auth_entry IS NOT NULL')
      .andWhere('q.valid_until > now()')
      .andWhere('q.deleted_at IS NULL');
    if (opts?.excludeQuoteId) {
      qb.andWhere('q.id <> :excludeQuoteId', { excludeQuoteId: opts.excludeQuoteId });
    }
    const row = await qb.getRawOne<{ sum: string }>();
    return BigInt(row?.sum ?? '0');
  }

  async findAcceptable(rfqId: string, quoteId: string): Promise<Quote | null> {
    return this.repository
      .createQueryBuilder('q')
      .where('q.id = :quoteId', { quoteId })
      .andWhere('q.rfq_id = :rfqId', { rfqId })
      .andWhere('q.status = :open', { open: Q_OPEN })
      .andWhere('q.seller_auth_entry IS NOT NULL')
      .andWhere('q.valid_until > now()')
      .getOne();
  }

  async casAccepted(manager: EntityManager, quoteId: string): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Quote)
      .set({ status: Q_ACCEPTED, updatedAt: () => 'now()' })
      .where('id = :quoteId AND status = :open', { quoteId, open: Q_OPEN })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  async expireWithReason(
    manager: EntityManager,
    quoteId: string,
    reason: string,
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Quote)
      .set({ status: Q_EXPIRED, statusReason: reason, updatedAt: () => 'now()' })
      .where('id = :quoteId AND status = :open', { quoteId, open: Q_OPEN })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  async supersedeOpenRivals(
    manager: EntityManager,
    rfqId: string,
    exceptQuoteId: string,
  ): Promise<number> {
    // Forward-only open → superseded on the RFQ's OTHER open quotes (frees their sellers' locked balance).
    const result = await manager
      .createQueryBuilder()
      .update(Quote)
      .set({ status: Q_SUPERSEDED, updatedAt: () => 'now()' })
      .where('rfq_id = :rfqId AND id <> :exceptQuoteId AND status = :open', {
        rfqId,
        exceptQuoteId,
        open: Q_OPEN,
      })
      .execute();
    return result.affected ?? 0;
  }
}
