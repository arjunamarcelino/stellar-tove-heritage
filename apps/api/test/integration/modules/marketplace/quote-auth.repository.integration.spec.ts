import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { QuotesModule } from '@modules/marketplace/quotes/quotes.module';
import { QUOTE_REPOSITORY, IQuoteRepository } from '@modules/marketplace/quotes/repositories/quote-repository.interface';
import { seedArtworkWithContract, seedOpenRfq, seedQuote } from '../../../shared/seed-marketplace';

/**
 * TOV-177 additions to the quote ledger: the buyer RFQ-detail read (`findOpenQuotesForRfq` + `acceptable`),
 * the seller-authorization write (`markAuthorized` / `sumAuthorizedLockedCount`), and the settlement
 * transitions (`casAccepted` / `expireWithReason` / `supersedeOpenRivals` + the `open → superseded` guard edge).
 *
 * NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`).
 */

describe('quote seller-authorization + settlement transitions (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let repo: IQuoteRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(QuotesModule);
    ds = moduleRef.get(DataSource);
    repo = moduleRef.get<IQuoteRepository>(QUOTE_REPOSITORY);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });
  beforeEach(async () => {
    await truncateTables(ds);
  });
  afterEach(async () => {
    await truncateTables(ds);
  });

  const em = (): EntityManager => ds.manager;
  async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
    return ds.query(text, params);
  }
  async function seedUserWithHandle(handle: string): Promise<string> {
    const rows = await q<{ id: string }>(
      `INSERT INTO users (is_active, kyc_status, handle) VALUES (true, 'not_submitted', $1) RETURNING id`,
      [handle],
    );
    return rows[0].id;
  }

  // ── findOpenQuotesForRfq (the buyer read surface) ─────────────────────────
  it('lists OPEN quotes price-ASC with pseudonymous handle + derived acceptable; hides non-open + secrets', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const handleA = `chigh_${randomUUID().slice(0, 8)}`;
    const handleB = `clow_${randomUUID().slice(0, 8)}`;
    const sellerA = await seedUserWithHandle(handleA);
    const sellerB = await seedUserWithHandle(handleB);
    // A (authorized, price 20) and B (open, unauthorized, price 10) — B should sort first (price ASC).
    await seedQuote(q, rfqId, contractId, { holderSub: sellerA, price: '20', count: '5', authorized: true });
    await seedQuote(q, rfqId, contractId, { holderSub: sellerB, price: '10', count: '3' });
    // A canceled quote is excluded from the list.
    await seedQuote(q, rfqId, contractId, { holderSub: randomUUID(), status: 'canceled' });

    const rows = await repo.findOpenQuotesForRfq(rfqId);
    expect(rows).toHaveLength(2);
    expect(rows[0].pricePerFractionStroops).toBe('10'); // price ASC
    expect(rows[0].sellerHandle).toBe(handleB);
    expect(rows[0].acceptable).toBe(false); // unauthorized
    expect(rows[1].pricePerFractionStroops).toBe('20');
    expect(rows[1].sellerHandle).toBe(handleA);
    expect(rows[1].acceptable).toBe(true); // authorized + open + live
    expect(rows[1].grossStroops).toBe('100'); // 5 × 20
    // No secret columns leak into the projected row.
    expect(Object.keys(rows[0])).not.toContain('sellerAuthEntry');
    expect(Object.keys(rows[0])).not.toContain('holderSub');
  });

  it('acceptable is false for an authorized-but-lapsed quote (valid_until passed)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    await seedQuote(q, rfqId, contractId, {
      authorized: true,
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      validUntil: new Date(Date.now() - 1 * 3_600_000).toISOString(),
    });
    const rows = await repo.findOpenQuotesForRfq(rfqId);
    expect(rows).toHaveLength(1);
    expect(rows[0].acceptable).toBe(false);
  });

  // ── markAuthorized + sumAuthorizedLockedCount ─────────────────────────────
  it('markAuthorized stamps the auth columns (CAS on open) and makes the quote acceptable', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const quoteId = await seedQuote(q, rfqId, contractId, { count: '7' });
    const ok = await repo.markAuthorized(em(), quoteId, {
      entry: Buffer.from('signed-entry'),
      expiresLedger: 12345,
      wallet: 'CWALLET',
    });
    expect(ok).toBe(true);
    const [row] = await q<{ seller_wallet_contract: string; seller_auth_expires_ledger: string; authorized_at: string }>(
      `SELECT seller_wallet_contract, seller_auth_expires_ledger, authorized_at FROM rfq_quotes WHERE id=$1`,
      [quoteId],
    );
    expect(row.seller_wallet_contract).toBe('CWALLET');
    expect(row.seller_auth_expires_ledger).toBe('12345');
    expect(row.authorized_at).not.toBeNull();
    // CAS on a non-open quote returns false.
    await q(`UPDATE rfq_quotes SET status='canceled' WHERE id=$1`, [quoteId]);
    expect(await repo.markAuthorized(em(), quoteId, { entry: Buffer.from('x'), expiresLedger: 1, wallet: 'C' })).toBe(false);
  });

  it('sumAuthorizedLockedCount counts only authorized + open + live quotes for (holder, token)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfq1 = await seedOpenRfq(q, artworkId, contractId);
    const rfq2 = await seedOpenRfq(q, artworkId, contractId);
    const rfq3 = await seedOpenRfq(q, artworkId, contractId);
    const holder = randomUUID();
    const ownQuote = await seedQuote(q, rfq1, contractId, { holderSub: holder, count: '8', authorized: true });
    // Unauthorized open quote does NOT lock balance.
    await seedQuote(q, rfq2, contractId, { holderSub: holder, count: '100' });
    // A different holder's authorized quote is excluded.
    await seedQuote(q, rfq3, contractId, { holderSub: randomUUID(), count: '50', authorized: true });
    expect(await repo.sumAuthorizedLockedCount(em(), holder, contractId)).toBe(8n);
    expect(await repo.sumAuthorizedLockedCount(em(), randomUUID(), contractId)).toBe(0n);
    // excludeQuoteId (#385): re-authorizing the holder's own quote must not count it against itself.
    expect(await repo.sumAuthorizedLockedCount(em(), holder, contractId, { excludeQuoteId: ownQuote })).toBe(0n);
  });

  // ── findAcceptable / casAccepted / expireWithReason / supersedeOpenRivals ──
  it('findAcceptable returns the quote only when open + authorized + live', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const authorized = await seedQuote(q, rfqId, contractId, { authorized: true });
    const unauthorized = await seedQuote(q, rfqId, contractId, { holderSub: randomUUID() });
    expect((await repo.findAcceptable(rfqId, authorized))!.id).toBe(authorized);
    expect(await repo.findAcceptable(rfqId, unauthorized)).toBeNull();
    // Wrong RFQ → null (pairing check).
    expect(await repo.findAcceptable(randomUUID(), authorized)).toBeNull();
  });

  it('casAccepted / expireWithReason / supersedeOpenRivals drive the settlement transitions', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const winner = await seedQuote(q, rfqId, contractId, { holderSub: randomUUID(), authorized: true });
    const rivalA = await seedQuote(q, rfqId, contractId, { holderSub: randomUUID() });
    const rivalB = await seedQuote(q, rfqId, contractId, { holderSub: randomUUID() });

    expect(await repo.casAccepted(em(), winner)).toBe(true);
    const superseded = await repo.supersedeOpenRivals(em(), rfqId, winner);
    expect(superseded).toBe(2);
    const statuses = await q<{ id: string; status: string }>(
      `SELECT id, status FROM rfq_quotes WHERE rfq_id=$1 ORDER BY created_at`,
      [rfqId],
    );
    const byId = Object.fromEntries(statuses.map((r) => [r.id, r.status]));
    expect(byId[winner]).toBe('accepted');
    expect(byId[rivalA]).toBe('superseded');
    expect(byId[rivalB]).toBe('superseded');
    // A re-CAS on the now-accepted winner loses.
    expect(await repo.casAccepted(em(), winner)).toBe(false);
  });

  it('expireWithReason flips open → expired with a status_reason (seller-fault path)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const quoteId = await seedQuote(q, rfqId, contractId);
    expect(await repo.expireWithReason(em(), quoteId, 'seller_balance_insufficient')).toBe(true);
    const [row] = await q<{ status: string; status_reason: string }>(
      `SELECT status, status_reason FROM rfq_quotes WHERE id=$1`,
      [quoteId],
    );
    expect(row.status).toBe('expired');
    expect(row.status_reason).toBe('seller_balance_insufficient');
  });

  it('migration 045 guard permits the open → superseded transition', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const quoteId = await seedQuote(q, rfqId, contractId);
    await q(`UPDATE rfq_quotes SET status='superseded' WHERE id=$1`, [quoteId]);
    const [row] = await q<{ status: string }>(`SELECT status FROM rfq_quotes WHERE id=$1`, [quoteId]);
    expect(row.status).toBe('superseded');
    // ...but superseded is terminal (no further transition).
    await expect(q(`UPDATE rfq_quotes SET status='open' WHERE id=$1`, [quoteId])).rejects.toThrow(/illegal status transition/i);
  });
});
