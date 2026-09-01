import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { Quote } from '../entities/quote.entity';

export const QUOTE_REPOSITORY = 'IQuoteRepository';

/** A new quote to insert (the repo forces `status='open'`). Money fields are canonical stroop strings. */
export interface NewQuote {
  rfqId: string;
  holderSub: string;
  fractionContractId: string;
  fractionCount: string;
  pricePerFractionStroops: string;
  validUntil: Date;
  idempotencyKeyHash: Buffer;
}

/** Composite lookup key for the durable-backstop idempotency replay. */
export interface QuoteIdempotencyKey {
  holderSub: string;
  rfqId: string;
  idempotencyKeyHash: Buffer;
}

/**
 * A projected OPEN-quote row for the buyer's RFQ-detail list surface (TOV-177 read). Money fields are stroop
 * strings; `sellerHandle` is the seller's pseudonymous public handle (NULL for a wallet-only holder). NEVER
 * carries `seller_auth_entry`/`holder_sub`/wallet — `acceptable` is the only authorization signal exposed.
 */
export interface OpenQuoteRow {
  quoteId: string;
  sellerHandle: string | null;
  fractionCount: string;
  pricePerFractionStroops: string;
  grossStroops: string;
  validUntil: Date;
  status: string;
  /** `open` AND the seller has a valid, non-expired stored authorization — the per-row Accept-CTA gate. */
  acceptable: boolean;
}

/** Seller-authorization payload stored on a quote at the authorize step (TOV-177). */
export interface AuthorizeQuotePatch {
  entry: Buffer;
  expiresLedger: number;
  wallet: string;
}

/**
 * Quote ledger port (TOV-175). All mutating/counting methods take an `EntityManager` so they compose inside
 * the service's advisory-locked `runInTransaction`. Every read below MUST match the partial-index predicate
 * (`status='open' AND deleted_at IS NULL`) so it is index-served, never a scan over accumulating terminal rows.
 */
export interface IQuoteRepository extends IBaseRepository<Quote> {
  /**
   * Insert an `open` quote via ON CONFLICT DO NOTHING targeted at `UQ_quotes_idem`
   * `(holder_sub, rfq_id, idempotency_key_hash)` — a hit returns `null` INSIDE the txn (a caught 23505 would
   * abort the surrounding transaction; do not use one). The conflict target is pinned to the idem columns so
   * ONLY an idempotency-key collision maps to the replay path (the active-per-RFQ slot is enforced
   * authoritatively by `hasOpenQuoteForRfq` under the advisory lock, before this insert).
   */
  insertOpen(manager: EntityManager, quote: NewQuote): Promise<Quote | null>;

  /**
   * True iff the holder already has an `open` (non-soft-deleted) quote on this RFQ. Called BOTH as a cheap
   * fast-fail before the chain read (no `manager` → default connection) AND authoritatively inside the
   * advisory lock (pass the txn `manager`). Served by
   * `UQ_quotes_active_per_rfq (rfq_id, holder_sub) WHERE status='open' AND deleted_at IS NULL`.
   *
   * `opts.excludeLapsed` adds `AND valid_until > now()` — used ONLY by the pre-lock fast-fail so a lapsed
   * (but not-yet-reaped) own quote is not a false 409: it will be reaped to `expired` inside the txn. The
   * authoritative under-lock check runs AFTER the reap, so it omits `excludeLapsed` and matches the index.
   */
  hasOpenQuoteForRfq(
    rfqId: string,
    holderSub: string,
    opts?: { manager?: EntityManager; excludeLapsed?: boolean },
  ): Promise<boolean>;

  /**
   * Σ `fraction_count` of the holder's OTHER `open`, not-yet-expired quotes on the same fraction contract —
   * the fractions "locked" against free balance. `COALESCE(SUM,0)` (empty set → 0, never `BigInt(null)`);
   * `valid_until > now()` residual on the partial `IDX_quotes_locked`. Runs inside the advisory lock.
   */
  sumOpenLockedCount(manager: EntityManager, holderSub: string, fractionContractId: string): Promise<bigint>;

  /**
   * Lazy-reap: flip the holder's OWN lapsed (`valid_until <= now()`) `open` quotes on this fraction contract
   * to `expired` (forward-only, allowed by the guard trigger). Run inside the lock BEFORE the locked-sum so
   * the sum sees only live commitments and the active-per-RFQ slot is freed for a re-quote. Returns rows reaped.
   */
  reapLapsed(manager: EntityManager, holderSub: string, fractionContractId: string): Promise<number>;

  /**
   * Durable-backstop replay after `insertOpen` returns `null` (a same-key retry that slipped past an evicted
   * Redis key in the commit→complete crash window): re-read by `(holder_sub, rfq_id, idempotency_key_hash)`.
   * Called outside the txn on the default connection — no `manager`.
   */
  findByIdempotency(key: QuoteIdempotencyKey): Promise<Quote | null>;

  // ── TOV-177: accept-and-settle read + seller-authorization + settlement transitions ────────────────────

  /**
   * The buyer's RFQ-detail list surface: OPEN quotes on an RFQ, joined to the seller's pseudonymous handle,
   * ordered price ASC then created_at ASC, each with a derived `acceptable`
   * (`status='open' AND seller_auth_entry IS NOT NULL AND valid_until > now()`). Never selects the raw auth
   * entry / holder_sub / wallet.
   */
  findOpenQuotesForRfq(rfqId: string): Promise<OpenQuoteRow[]>;

  /**
   * Store the seller's signed `accept_quote` authorization on an `open` quote (seller-authorize step). CAS on
   * `status='open'` → `false` if the quote is no longer open. The auth columns are mutable/re-writable (absent
   * from the guard's freeze list); `status`/`valid_until` are untouched.
   */
  markAuthorized(manager: EntityManager, quoteId: string, patch: AuthorizeQuotePatch): Promise<boolean>;

  /**
   * Σ `fraction_count` of the holder's AUTHORIZED (`seller_auth_entry IS NOT NULL`), `open`, not-yet-expired
   * quotes on the same fraction contract — the fractions committed against free balance for the over-auth gate.
   * `COALESCE(SUM,0)`; runs inside the authorize advisory lock. `opts.excludeQuoteId` drops that quote from the
   * sum so RE-authorizing an already-authorized quote does not count its own commitment against itself (TOV-177
   * #385) — a fully-committed quote whose on-chain signature lapsed inside its validity window can be re-signed.
   */
  sumAuthorizedLockedCount(
    manager: EntityManager,
    holderSub: string,
    fractionContractId: string,
    opts?: { excludeQuoteId?: string },
  ): Promise<bigint>;

  /** The quote iff it is on this RFQ AND `open` AND authorized AND `valid_until > now()` — else `null`. */
  findAcceptable(rfqId: string, quoteId: string): Promise<Quote | null>;

  /** CAS `open → accepted` on the winning quote at settlement. `false` ⇒ no longer open. */
  casAccepted(manager: EntityManager, quoteId: string): Promise<boolean>;

  /** CAS `open → expired` + `status_reason` on a seller-fault settlement revert. `false` ⇒ no longer open. */
  expireWithReason(manager: EntityManager, quoteId: string, reason: string): Promise<boolean>;

  /** Flip the RFQ's OTHER `open` quotes to `superseded` when one is accepted. Returns rows superseded. */
  supersedeOpenRivals(manager: EntityManager, rfqId: string, exceptQuoteId: string): Promise<number>;
}
