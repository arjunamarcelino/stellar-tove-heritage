import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestingModule } from '../../../setup';

/**
 * Verifies the TOV-40 data-integrity hardening at the DB level (the CHECKs + partial indexes the e2e
 * fake never exercises). Raw SQL against the pre-migrated tove_test DB — no Nest feature modules needed.
 */
describe('wallet export DB constraints (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;

  beforeAll(async () => {
    moduleRef = await createTestingModule();
    ds = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await ds.query(text, params));
  }

  async function seedWallet(): Promise<{ userId: string; walletId: string }> {
    const users = await q<{ id: string }>('INSERT INTO users DEFAULT VALUES RETURNING id');
    const wallets = await q<{ id: string }>(
      "INSERT INTO wallets (user_id, contract_address, kind) VALUES ($1, $2, 'embedded_passkey') RETURNING id",
      [users[0].id, `C${'A'.repeat(55)}`],
    );
    return { userId: users[0].id, walletId: wallets[0].id };
  }

  async function newExport(walletId: string, userId: string, status = 'pending'): Promise<string> {
    const rows = await q<{ id: string }>(
      'INSERT INTO wallet_exports (wallet_id, user_id, target_address, status, completed_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [walletId, userId, `G${'A'.repeat(55)}`, status, status === 'completed' ? new Date() : null],
    );
    return rows[0].id;
  }

  beforeEach(async () => {
    await q('TRUNCATE TABLE internal_audit_log, wallet_export_items, wallet_exports, fraction_kyc_allowlist, wallets, users CASCADE');
  });

  it('allows only one non-completed export per wallet', async () => {
    const { userId, walletId } = await seedWallet();
    await newExport(walletId, userId, 'pending');
    await expect(newExport(walletId, userId, 'submitting')).rejects.toThrow();
    // A completed export does not block a fresh pending one.
    await q("UPDATE wallet_exports SET status='completed', completed_at=now() WHERE wallet_id=$1", [walletId]);
    await expect(newExport(walletId, userId, 'pending')).resolves.toBeTruthy();
  });

  it('enforces status <-> completed_at consistency on wallet_exports', async () => {
    const { userId, walletId } = await seedWallet();
    await expect(
      q('INSERT INTO wallet_exports (wallet_id, user_id, target_address, status) VALUES ($1,$2,$3,$4)', [
        walletId,
        userId,
        `G${'A'.repeat(55)}`,
        'completed', // completed but completed_at NULL -> CHECK violation
      ]),
    ).rejects.toThrow();
  });

  it('rejects a zero / non-numeric export item amount', async () => {
    const { userId, walletId } = await seedWallet();
    const exportId = await newExport(walletId, userId);
    const insItem = (amount: string) =>
      q('INSERT INTO wallet_export_items (export_id, token_contract, token_kind, amount_scaled) VALUES ($1,$2,$3,$4)', [
        exportId,
        `C${'B'.repeat(55)}`,
        'usdc',
        amount,
      ]);
    await expect(insItem('0')).rejects.toThrow();
    await expect(insItem('12x')).rejects.toThrow();
    await expect(insItem('1000000')).resolves.toBeTruthy();
  });

  it('enforces wallets status=exported <-> removed_at', async () => {
    const { walletId } = await seedWallet();
    await expect(
      q("UPDATE wallets SET status='exported' WHERE id=$1", [walletId]), // removed_at still NULL
    ).rejects.toThrow();
    await expect(
      q("UPDATE wallets SET status='exported', removed_at=now() WHERE id=$1", [walletId]),
    ).resolves.toBeTruthy();
  });

  it('allows re-adding a soft-deleted allowlist address (partial unique over live rows)', async () => {
    const addr = `G${'C'.repeat(55)}`;
    await q('INSERT INTO fraction_kyc_allowlist (target_address) VALUES ($1)', [addr]);
    await expect(
      q('INSERT INTO fraction_kyc_allowlist (target_address) VALUES ($1)', [addr]),
    ).rejects.toThrow();
    await q('UPDATE fraction_kyc_allowlist SET deleted_at=now() WHERE target_address=$1', [addr]);
    await expect(
      q('INSERT INTO fraction_kyc_allowlist (target_address) VALUES ($1)', [addr]),
    ).resolves.toBeTruthy();
  });

  it('atomically claims an item for submit (single-writer CAS)', async () => {
    const { userId, walletId } = await seedWallet();
    const exportId = await newExport(walletId, userId);
    const items = await q<{ id: string }>(
      "INSERT INTO wallet_export_items (export_id, token_contract, token_kind, amount_scaled, status) VALUES ($1,$2,'usdc','1000000','pending') RETURNING id",
      [exportId, `C${'B'.repeat(55)}`],
    );
    const itemId = items[0].id;
    // The CAS: pending|failed -> submitted, guarded by status. Assert on the resulting status so the
    // test is robust to the driver's UPDATE-return shape and proves the guard directly.
    const claim = () =>
      q("UPDATE wallet_export_items SET status='submitted' WHERE id=$1 AND status IN ('pending','failed')", [itemId]);
    const statusOf = async () =>
      (await q<{ status: string }>('SELECT status FROM wallet_export_items WHERE id=$1', [itemId]))[0].status;

    await claim(); // first (pending) wins
    expect(await statusOf()).toBe('submitted');
    await claim(); // second is a no-op (already submitted) — item is not re-sent
    expect(await statusOf()).toBe('submitted');
    // A failed item is re-claimable on retry.
    await q("UPDATE wallet_export_items SET status='failed' WHERE id=$1", [itemId]);
    await claim();
    expect(await statusOf()).toBe('submitted');
    // A confirmed item is never re-claimable.
    await q("UPDATE wallet_export_items SET status='confirmed', tx_hash='abc', ledger=1 WHERE id=$1", [itemId]);
    await claim();
    expect(await statusOf()).toBe('confirmed');
  });

  it('cascades item deletes when the parent export is deleted (FK ON DELETE CASCADE)', async () => {
    const { userId, walletId } = await seedWallet();
    const exportId = await newExport(walletId, userId);
    await q(
      "INSERT INTO wallet_export_items (export_id, token_contract, token_kind, amount_scaled) VALUES ($1,$2,'usdc','1000000')",
      [exportId, `C${'B'.repeat(55)}`],
    );
    await q('DELETE FROM wallet_exports WHERE id=$1', [exportId]);
    const items = await q<{ count: string }>('SELECT COUNT(*) AS count FROM wallet_export_items WHERE export_id=$1', [
      exportId,
    ]);
    expect(items[0].count).toBe('0');
  });

  it('rejects UPDATE and DELETE on internal_audit_log (append-only trigger)', async () => {
    const rows = await q<{ id: string }>(
      "INSERT INTO internal_audit_log (actor_type, kind, subject_type, subject_id) VALUES ('system','wallet.export.requested','wallet_export',gen_random_uuid()) RETURNING id",
    );
    const id = rows[0].id;
    await expect(q("UPDATE internal_audit_log SET kind='tampered' WHERE id=$1", [id])).rejects.toThrow();
    await expect(q('DELETE FROM internal_audit_log WHERE id=$1', [id])).rejects.toThrow();
    // The row is still intact + untouched.
    const check = await q<{ kind: string }>('SELECT kind FROM internal_audit_log WHERE id=$1', [id]);
    expect(check[0].kind).toBe('wallet.export.requested');
    // Cleanup (TRUNCATE bypasses row triggers).
    await q('TRUNCATE TABLE internal_audit_log');
  });
});
