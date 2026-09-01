import { DataSource, EntityManager } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { insertOffering } from '../../../shared/seed-offering';
import { OfferingsModule } from '@modules/offerings/offerings.module';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '@modules/offerings/repositories/offering-repository.interface';
import {
  OFFERING_APPROVAL_REPOSITORY,
  IOfferingApprovalRepository,
} from '@modules/offerings/repositories/offering-approval-repository.interface';

/**
 * DB + repository guard for the TOV-154 (FR-05.02) multi-sig approval + escrow-deploy surface. Exercises
 * `OfferingRepository` (the escrow-deploy dual-latch CAS methods + the backoffice list/expiry reads) and
 * `OfferingApprovalRepository` (the append-only quorum ledger) against the pre-migrated `tove_test` DB via
 * the config-free `OfferingsModule`, and drift-guards migration 034's partial-index predicates and the
 * append-only trigger (`fn_offering_approvals_append_only`) directly at the SQL layer.
 *
 * NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`).
 */

// Postgres SQLSTATEs asserted below.
const CHECK_VIOLATION = '23514';

// A valid escrow contract address (^C[A-Z2-7]{55}$, 56 chars) for CHK_off_escrow_addr / CHK_off_approved_has_escrow.
const ESCROW_ADDR = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

// Fixed admin subs (offering_approvals.admin_sub is a uuid; no FK — audit-actor semantics).
const ADMIN_SUB = '00000000-0000-4000-8000-00000000ad11'; // offerings.created_by_admin_sub
const ADMIN_A = '00000000-0000-4000-8000-00000000aaaa';
const ADMIN_B = '00000000-0000-4000-8000-00000000bbbb';

interface PgError {
  code?: string;
  constraint?: string;
  driverError?: { code?: string; constraint?: string };
}

/** Run `fn`, assert it rejected with the given SQLSTATE (+ optional constraint name). */
async function expectPgError(fn: () => Promise<unknown>, code: string, constraint?: string): Promise<void> {
  let err: PgError | undefined;
  try {
    await fn();
  } catch (e) {
    err = e as PgError;
  }
  expect(err, 'expected the query to reject').toBeDefined();
  const actualCode = err!.code ?? err!.driverError?.code;
  const actualConstraint = err!.constraint ?? err!.driverError?.constraint;
  expect(actualCode).toBe(code);
  if (constraint !== undefined) {
    expect(actualConstraint).toBe(constraint);
  }
}

describe('offering approval + escrow constraints (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let repo: IOfferingRepository;
  let approvalRepo: IOfferingApprovalRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(OfferingsModule);
    ds = moduleRef.get(DataSource);
    repo = moduleRef.get<IOfferingRepository>(OFFERING_REPOSITORY);
    approvalRepo = moduleRef.get<IOfferingApprovalRepository>(OFFERING_APPROVAL_REPOSITORY);
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

  /** Seed a user → artwork → DEPLOYED fraction_contract; return the parent ids for offerings. */
  async function seedDeployedArtwork(): Promise<{ artworkId: string; fractionContractId: string }> {
    const users = await q<{ id: string }>(
      `INSERT INTO users (is_active, kyc_status) VALUES (true, 'not_submitted') RETURNING id`,
    );
    const artworks = await q<{ id: string }>(
      `INSERT INTO artworks (status, artist_user_id, title) VALUES ('fractionalized', $1, 'A') RETURNING id`,
      [users[0].id],
    );
    const artworkId = artworks[0].id;
    const contracts = await q<{ id: string }>(
      `INSERT INTO fraction_contracts (
         artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address,
         total_supply, artist_retention_pct, treasury_retention_pct,
         artist_retention_amount, treasury_retention_amount, artist_lockup_days, treasury_lockup_days
       ) VALUES ($1, 'deployed', $2, $3, 'ArtToken', 'ART', $4,
         '1000000', 10, 5, '100000', '50000', 365, 730)
       RETURNING id`,
      [
        artworkId,
        'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd',
        'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
      ],
    );
    return { artworkId, fractionContractId: contracts[0].id };
  }

  interface OfferingOverrides {
    status?: string;
    windowOpenAt?: string;
    windowCloseAt?: string;
  }

  /** Insert one offering row (valid defaults) and return its id. Each call uses a fresh artwork. */
  async function seedOffering(o: OfferingOverrides = {}): Promise<string> {
    const parents = await seedDeployedArtwork();
    return insertOffering(q, {
      artworkId: parents.artworkId,
      fractionContractId: parents.fractionContractId,
      status: o.status ?? 'planned',
      windowOpenAt: o.windowOpenAt ?? '2026-09-01T00:00:00Z',
      windowCloseAt: o.windowCloseAt ?? '2026-09-08T00:00:00Z',
      createdByAdminSub: ADMIN_SUB,
    });
  }

  /** Raw-force an offering into a non-planned status, supplying an escrow address where the CHECK needs it. */
  async function forceStatus(id: string, status: string): Promise<void> {
    const needsEscrow = ['approved', 'opened', 'subscribed', 'settled'].includes(status);
    if (needsEscrow) {
      await q(
        `UPDATE offerings SET status=$2, escrow_deploy_status='deployed', escrow_contract_address=$3 WHERE id=$1`,
        [id, status, ESCROW_ADDR],
      );
    } else {
      await q(`UPDATE offerings SET status=$2 WHERE id=$1`, [id, status]);
    }
  }

  async function readOffering(id: string): Promise<{
    status: string;
    escrow_deploy_status: string | null;
    escrow_contract_address: string | null;
    snapshot_artist_address: string | null;
  }> {
    const rows = await q<{
      status: string;
      escrow_deploy_status: string | null;
      escrow_contract_address: string | null;
      snapshot_artist_address: string | null;
    }>(
      `SELECT status, escrow_deploy_status, escrow_contract_address, snapshot_artist_address
         FROM offerings WHERE id=$1`,
      [id],
    );
    return rows[0];
  }

  // ── I1 insertSignature idempotency ──────────────────────────────────────────────────────────────
  describe('insertSignature (append-only, idempotent)', () => {
    it('I1: a second insert for the same (offering, admin) is a benign no-op (23505 swallowed)', async () => {
      const id = await seedOffering();
      await approvalRepo.insertSignature(em(), id, ADMIN_A);
      await approvalRepo.insertSignature(em(), id, ADMIN_A); // duplicate live signer → swallowed
      const count = await approvalRepo.countLiveSigners(id, new Set([ADMIN_A]), em());
      expect(count).toBe(1);
    });
  });

  // ── I2 countLiveSigners roster intersection ─────────────────────────────────────────────────────
  describe('countLiveSigners (roster-intersected, Enhancement #2)', () => {
    it('I2: counts only live signers whose admin_sub is in the roster', async () => {
      const id = await seedOffering();
      await approvalRepo.insertSignature(em(), id, ADMIN_A);
      await approvalRepo.insertSignature(em(), id, ADMIN_B);
      expect(await approvalRepo.countLiveSigners(id, new Set([ADMIN_A]), em())).toBe(1);
      expect(await approvalRepo.countLiveSigners(id, new Set([ADMIN_A, ADMIN_B]), em())).toBe(2);
    });
  });

  // ── I3 append-only trigger (fn_offering_approvals_append_only) ───────────────────────────────────
  describe('append-only + soft-delete-final trigger', () => {
    it('I3: rejects mutating an immutable column and DELETE, but allows the one-way soft-delete', async () => {
      const id = await seedOffering();
      await approvalRepo.insertSignature(em(), id, ADMIN_A);

      // Mutating an immutable column is frozen by the trigger.
      await expect(
        q(`UPDATE offering_approvals SET admin_sub=$2 WHERE offering_id=$1`, [id, ADMIN_B]),
      ).rejects.toThrow(/immutable columns cannot change/i);

      // Hard DELETE is blocked (append-only ledger).
      await expect(q(`DELETE FROM offering_approvals WHERE offering_id=$1`, [id])).rejects.toThrow(
        /append-only \(DELETE not allowed\)/i,
      );

      // The one-way soft-delete (NULL → timestamp) is allowed.
      await q(`UPDATE offering_approvals SET deleted_at=now() WHERE offering_id=$1 AND deleted_at IS NULL`, [id]);
      const rows = await q<{ deleted_at: Date | null }>(
        `SELECT deleted_at FROM offering_approvals WHERE offering_id=$1`,
        [id],
      );
      expect(rows[0].deleted_at).not.toBeNull();
    });

    it('I3b: soft-delete is final — un-expire and immutable+soft-delete combos are rejected', async () => {
      const id = await seedOffering();
      await approvalRepo.insertSignature(em(), id, ADMIN_A);

      // Combined immutable-column change + soft-delete on a live row: the immutable-column guard fires.
      await expect(
        q(`UPDATE offering_approvals SET admin_sub=$2, deleted_at=now() WHERE offering_id=$1`, [id, ADMIN_B]),
      ).rejects.toThrow(/immutable columns cannot change/i);

      // Soft-delete the row, then attempt to un-expire it.
      await q(`UPDATE offering_approvals SET deleted_at=now() WHERE offering_id=$1 AND deleted_at IS NULL`, [id]);
      await expect(
        q(`UPDATE offering_approvals SET deleted_at=NULL WHERE offering_id=$1`, [id]),
      ).rejects.toThrow(/soft-delete is final/i);
    });
  });

  // ── I4 casEscrowDeploying (enqueue-once claim) ──────────────────────────────────────────────────
  describe('casEscrowDeploying', () => {
    it('I4: claims a fresh planned offering once, retries a failed one, and refuses a non-planned one', async () => {
      // Fresh planned (escrow_deploy_status NULL) → wins, sets 'deploying'; second call loses.
      const fresh = await seedOffering();
      expect(await repo.casEscrowDeploying(em(), fresh)).toBe(true);
      expect((await readOffering(fresh)).escrow_deploy_status).toBe('deploying');
      expect(await repo.casEscrowDeploying(em(), fresh)).toBe(false);

      // A prior 'failed' deploy is retryable → wins.
      const failed = await seedOffering();
      await q(`UPDATE offerings SET escrow_deploy_status='failed' WHERE id=$1`, [failed]);
      expect(await repo.casEscrowDeploying(em(), failed)).toBe(true);

      // A non-planned offering (status gate) → loses.
      const canceled = await seedOffering();
      await forceStatus(canceled, 'canceled');
      expect(await repo.casEscrowDeploying(em(), canceled)).toBe(false);
    });
  });

  // ── I5 casEscrowDeployed (success dual-latch) ───────────────────────────────────────────────────
  describe('casEscrowDeployed', () => {
    it('I5: latches deploying→deployed + planned→approved with an address (CHK_off_approved_has_escrow)', async () => {
      const id = await seedOffering();
      expect(await repo.casEscrowDeploying(em(), id)).toBe(true);
      expect(await repo.casEscrowDeployed(em(), id, { address: ESCROW_ADDR })).toBe(true);

      const row = await readOffering(id);
      expect(row.status).toBe('approved');
      expect(row.escrow_deploy_status).toBe('deployed');
      expect(row.escrow_contract_address).toBe(ESCROW_ADDR);
    });

    it('I5b: flipping status→approved with a NULL escrow address violates CHK_off_approved_has_escrow (23514)', async () => {
      const id = await seedOffering(); // escrow_contract_address NULL
      await expectPgError(
        () => q(`UPDATE offerings SET status='approved' WHERE id=$1`, [id]),
        CHECK_VIOLATION,
        'CHK_off_approved_has_escrow',
      );
    });

    it('I5c (todo 288): does not resurrect a deploying row that was concurrently canceled (status recheck)', async () => {
      const id = await seedOffering();
      expect(await repo.casEscrowDeploying(em(), id)).toBe(true);
      // Simulate a concurrent cancel of an in-flight deploy.
      await q(`UPDATE offerings SET status='canceled' WHERE id=$1`, [id]);
      // casEscrowDeployed now requires status='planned' → must NOT flip a canceled offering to approved.
      expect(await repo.casEscrowDeployed(em(), id, { address: ESCROW_ADDR })).toBe(false);
      expect((await readOffering(id)).status).toBe('canceled');
    });
  });

  // ── I6 casOpened (window-open sweep) ────────────────────────────────────────────────────────────
  describe('casOpened', () => {
    it('I6: opens an approved offering whose window is currently open; refuses a future window', async () => {
      // Open now (window_open_at past, window_close_at future) → opens.
      const due = await seedOffering({ windowOpenAt: '2020-01-01T00:00:00Z', windowCloseAt: '2099-01-08T00:00:00Z' });
      await forceStatus(due, 'approved');
      expect(await repo.casOpened(em(), due)).toBe(true);
      expect((await readOffering(due)).status).toBe('opened');

      // Not yet due (window_open_at in the future) → stays approved.
      const future = await seedOffering({ windowOpenAt: '2099-01-01T00:00:00Z', windowCloseAt: '2099-01-08T00:00:00Z' });
      await forceStatus(future, 'approved');
      expect(await repo.casOpened(em(), future)).toBe(false);
      expect((await readOffering(future)).status).toBe('approved');
    });

    it('I6b (todo 288): refuses to auto-open an offering whose entire window has already elapsed', async () => {
      const expired = await seedOffering({ windowOpenAt: '2020-01-01T00:00:00Z', windowCloseAt: '2020-01-08T00:00:00Z' });
      await forceStatus(expired, 'approved');
      expect(await repo.casOpened(em(), expired)).toBe(false);
      expect((await readOffering(expired)).status).toBe('approved');
      // findDueForOpen also excludes it.
      const due = await repo.findDueForOpen(50);
      expect(due.map((o) => o.id)).not.toContain(expired);
    });
  });

  // ── I7 softDeleteAllForOffering ─────────────────────────────────────────────────────────────────
  describe('softDeleteAllForOffering', () => {
    it('I7: soft-deletes all live rows; a fresh signature then succeeds (partial-unique covers live only)', async () => {
      const id = await seedOffering();
      await approvalRepo.insertSignature(em(), id, ADMIN_A);
      await approvalRepo.insertSignature(em(), id, ADMIN_B);

      await approvalRepo.softDeleteAllForOffering(em(), id);
      expect(await approvalRepo.countLiveSigners(id, new Set([ADMIN_A, ADMIN_B]), em())).toBe(0);

      // Re-signing the same admin succeeds: the partial-unique index only covers live (deleted_at IS NULL) rows.
      await approvalRepo.insertSignature(em(), id, ADMIN_A);
      expect(await approvalRepo.countLiveSigners(id, new Set([ADMIN_A, ADMIN_B]), em())).toBe(1);
    });
  });

  // ── I8 findExpiredOfferingIds (7d expiry sweep) ─────────────────────────────────────────────────
  describe('findExpiredOfferingIds', () => {
    it('I8: returns only planned offerings with a live approval older than the ttl', async () => {
      const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

      // planned + approval 10 days old → expired → returned.
      const expired = await seedOffering();
      await q(
        `INSERT INTO offering_approvals (offering_id, admin_sub, created_at) VALUES ($1, $2, now() - interval '10 days')`,
        [expired, ADMIN_A],
      );

      // planned + approval 1 day old → within ttl → not returned.
      const recent = await seedOffering();
      await q(
        `INSERT INTO offering_approvals (offering_id, admin_sub, created_at) VALUES ($1, $2, now() - interval '1 day')`,
        [recent, ADMIN_A],
      );

      // non-planned (approved) + approval 10 days old → filtered by status → not returned.
      const approved = await seedOffering();
      await forceStatus(approved, 'approved');
      await q(
        `INSERT INTO offering_approvals (offering_id, admin_sub, created_at) VALUES ($1, $2, now() - interval '10 days')`,
        [approved, ADMIN_A],
      );

      const ids = await approvalRepo.findExpiredOfferingIds(TTL_MS, 50);
      expect(ids).toContain(expired);
      expect(ids).not.toContain(recent);
      expect(ids).not.toContain(approved);
    });

    it('I8b (todo 283): excludes a planned offering that is mid-deploy (escrow_deploy_status set)', async () => {
      const TTL_MS = 7 * 24 * 60 * 60 * 1000;
      const wedged = await seedOffering();
      await q(`UPDATE offerings SET escrow_deploy_status='deploying' WHERE id=$1`, [wedged]);
      await q(
        `INSERT INTO offering_approvals (offering_id, admin_sub, created_at) VALUES ($1, $2, now() - interval '10 days')`,
        [wedged, ADMIN_A],
      );
      const ids = await approvalRepo.findExpiredOfferingIds(TTL_MS, 50);
      // status is still 'planned' but the deploy latch is set — the expiry sweep must NOT wipe its approvals.
      expect(ids).not.toContain(wedged);
    });
  });

  // ── findStaleDeploying (P1 backstop, todo 283) ──────────────────────────────────────────────────
  describe('findStaleDeploying', () => {
    it('returns deploying rows older than grace, excluding fresh and non-deploying', async () => {
      const stale = await seedOffering();
      await q(
        `UPDATE offerings SET escrow_deploy_status='deploying', updated_at = now() - interval '5 minutes' WHERE id=$1`,
        [stale],
      );
      const fresh = await seedOffering();
      await q(`UPDATE offerings SET escrow_deploy_status='deploying', updated_at = now() WHERE id=$1`, [fresh]);
      const notDeploying = await seedOffering(); // planned, escrow_deploy_status NULL

      const rows = await repo.findStaleDeploying(120_000, 50);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(stale);
      expect(ids).not.toContain(fresh);
      expect(ids).not.toContain(notDeploying);
    });
  });

  // ── I9 approvalSummariesFor (batched N+1-free tallies) ──────────────────────────────────────────
  describe('approvalSummariesFor', () => {
    it('I9: returns per-offering count + youApproved for the caller across a batch', async () => {
      const o1 = await seedOffering();
      const o2 = await seedOffering();
      await approvalRepo.insertSignature(em(), o1, ADMIN_A);
      await approvalRepo.insertSignature(em(), o1, ADMIN_B);
      await approvalRepo.insertSignature(em(), o2, ADMIN_B);

      const roster = new Set([ADMIN_A, ADMIN_B]);
      const summaries = await approvalRepo.approvalSummariesFor([o1, o2], roster, ADMIN_A);

      expect(summaries.get(o1)).toEqual({ count: 2, youApproved: true });
      expect(summaries.get(o2)).toEqual({ count: 1, youApproved: false });
    });
  });

  // ── I10 listForBackoffice (status filter + pagination + createdAt DESC + artworkId) ─────────────
  describe('listForBackoffice', () => {
    it('I10: filters by status subset, orders createdAt DESC, paginates, and narrows by artworkId', async () => {
      // Four offerings on distinct artworks with staggered created_at (oldest → newest).
      const parentsA = await seedDeployedArtwork();
      const oA = await insertOffering(q, {
        artworkId: parentsA.artworkId,
        fractionContractId: parentsA.fractionContractId,
        status: 'planned',
        windowOpenAt: '2026-09-01T00:00:00Z',
        windowCloseAt: '2026-09-08T00:00:00Z',
        createdByAdminSub: ADMIN_SUB,
        createdAt: '2026-01-01T00:00:00Z',
      });

      const oB = await seedOffering();
      await forceStatus(oB, 'approved');
      await q(`UPDATE offerings SET created_at='2026-01-02T00:00:00Z' WHERE id=$1`, [oB]);

      const oC = await seedOffering();
      await forceStatus(oC, 'opened');
      await q(`UPDATE offerings SET created_at='2026-01-03T00:00:00Z' WHERE id=$1`, [oC]);

      const oD = await seedOffering();
      await forceStatus(oD, 'canceled');
      await q(`UPDATE offerings SET created_at='2026-01-04T00:00:00Z' WHERE id=$1`, [oD]);

      // status subset {planned, approved}, newest-first.
      const [rows, total] = await repo.listForBackoffice({
        statuses: ['planned', 'approved'],
        page: 1,
        limit: 10,
      });
      expect(total).toBe(2);
      expect(rows.map((r) => r.id)).toEqual([oB, oA]); // createdAt DESC

      // pagination: one per page.
      const [page1] = await repo.listForBackoffice({ statuses: ['planned', 'approved'], page: 1, limit: 1 });
      const [page2] = await repo.listForBackoffice({ statuses: ['planned', 'approved'], page: 2, limit: 1 });
      expect(page1.map((r) => r.id)).toEqual([oB]);
      expect(page2.map((r) => r.id)).toEqual([oA]);

      // artworkId filter.
      const [scoped, scopedTotal] = await repo.listForBackoffice({
        statuses: ['planned', 'approved', 'opened', 'subscribed'],
        artworkId: parentsA.artworkId,
        page: 1,
        limit: 10,
      });
      expect(scopedTotal).toBe(1);
      expect(scoped.map((r) => r.id)).toEqual([oA]);
    });
  });

  // ── I11 drift-guards: partial-index predicates (pg_indexes) ─────────────────────────────────────
  describe('index predicate drift-guards', () => {
    it('I11: UQ_offering_approvals_signer is scoped to live rows, IDX_off_approved_open_due to approved rows', async () => {
      const signer = await q<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_offering_approvals_signer'`,
      );
      expect(signer).toHaveLength(1);
      expect(signer[0].indexdef).toMatch(/deleted_at IS NULL/i);

      const openDue = await q<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'IDX_off_approved_open_due'`,
      );
      expect(openDue).toHaveLength(1);
      // Postgres normalizes `status = 'approved'` to `(status)::text = 'approved'::text`.
      expect(openDue[0].indexdef).toMatch(/'approved'/i);
      expect(openDue[0].indexdef).toMatch(/deleted_at IS NULL/i);

      // todo 286: the backoffice-list supporting index (migration 035) — status prefix + created_at sort.
      const list = await q<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'IDX_offerings_list'`,
      );
      expect(list).toHaveLength(1);
      expect(list[0].indexdef).toMatch(/status/i);
      expect(list[0].indexdef).toMatch(/created_at DESC/i);
      expect(list[0].indexdef).toMatch(/deleted_at IS NULL/i);
    });
  });
});
