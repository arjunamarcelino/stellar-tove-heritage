import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import { createTestingModule, truncateTables } from '../../setup';
import { KycAllowlistEvent } from '@modules/kyc-allowlist/entities/kyc-allowlist-event.entity';
import { KycAllowlistState } from '@modules/kyc-allowlist/entities/kyc-allowlist-state.entity';
import { KycAllowlistEventRepository } from '@modules/kyc-allowlist/repositories/kyc-allowlist-event.repository';
import { KYC_ALLOWLIST_EVENT_REPOSITORY } from '@modules/kyc-allowlist/repositories/kyc-allowlist-event-repository.interface';
import type { IKycAllowlistEventRepository } from '@modules/kyc-allowlist/repositories/kyc-allowlist-event-repository.interface';
import { KycAllowlistStateRepository } from '@modules/kyc-allowlist/repositories/kyc-allowlist-state.repository';
import { KYC_ALLOWLIST_STATE_REPOSITORY } from '@modules/kyc-allowlist/repositories/kyc-allowlist-state-repository.interface';
import type { IKycAllowlistStateRepository } from '@modules/kyc-allowlist/repositories/kyc-allowlist-state-repository.interface';

/** NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`). */
@Module({
  imports: [TypeOrmModule.forFeature([KycAllowlistEvent, KycAllowlistState])],
  providers: [
    { provide: KYC_ALLOWLIST_EVENT_REPOSITORY, useClass: KycAllowlistEventRepository },
    { provide: KYC_ALLOWLIST_STATE_REPOSITORY, useClass: KycAllowlistStateRepository },
  ],
})
class TestKycAllowlistModule {}

const W1 = StrKey.encodeContract(Buffer.alloc(32, 1));
const HASH = 'a'.repeat(64);
const ADMIN = '00000000-0000-4000-8000-00000000ad01';

describe('KYC allowlist repositories + schema integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let events: IKycAllowlistEventRepository;
  let state: IKycAllowlistStateRepository;

  beforeAll(async () => {
    module = await createTestingModule(TestKycAllowlistModule);
    dataSource = module.get(DataSource);
    events = module.get(KYC_ALLOWLIST_EVENT_REPOSITORY);
    state = module.get(KYC_ALLOWLIST_STATE_REPOSITORY);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  const insertRaw = (cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
    return dataSource.query(
      `INSERT INTO kyc_allowlist_events (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${placeholders})`,
      keys.map((k) => cols[k]),
    );
  };

  it('append() inserts rows; findByWallet returns them', async () => {
    const batchId = randomUUID();
    await events.append(
      [
        { batchId, wallet: W1, action: 'add', adminId: ADMIN, txHash: HASH, reason: 'kyc_passed', result: 'confirmed' },
        { batchId, wallet: W1, action: 'remove', adminId: ADMIN, result: 'noop' },
      ],
      dataSource.manager,
    );
    const rows = await dataSource.query<{ result: string }[]>(
      `SELECT result FROM kyc_allowlist_events WHERE wallet=$1 ORDER BY result`,
      [W1],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.result)).toEqual(['confirmed', 'noop']);
  });

  it('is append-only: UPDATE and DELETE are rejected by the trigger', async () => {
    const batchId = randomUUID();
    await events.append([{ batchId, wallet: W1, action: 'add', adminId: ADMIN, txHash: HASH, result: 'confirmed' }], dataSource.manager);
    const [{ id }] = await dataSource.query<{ id: string }[]>(`SELECT id FROM kyc_allowlist_events LIMIT 1`);
    await expect(dataSource.query(`UPDATE kyc_allowlist_events SET result='failed' WHERE id=$1`, [id])).rejects.toBeTruthy();
    await expect(dataSource.query(`DELETE FROM kyc_allowlist_events WHERE id=$1`, [id])).rejects.toBeTruthy();
  });

  it('rejects a confirmed row without a tx_hash (CHK_kae_confirmed_has_hash)', async () => {
    await expect(
      insertRaw({ batch_id: randomUUID(), wallet: W1, action: 'add', admin_id: ADMIN, result: 'confirmed' }),
    ).rejects.toBeTruthy();
  });

  it.each([
    // TOV-243: `^[GC][A-Z2-7]{55}$` now accepts G-addresses; a muxed M… (69 chars, not G/C) is still rejected.
    ['muxed M-address', { wallet: 'MB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJIAAAAAAAAAAAAHKSA', action: 'add', result: 'noop' }],
    ['bad action', { wallet: W1, action: 'freeze', result: 'noop' }],
    ['bad result', { wallet: W1, action: 'add', result: 'maybe' }],
  ])('rejects %s via CHECK constraint', async (_label, extra) => {
    await expect(insertRaw({ batch_id: randomUUID(), admin_id: ADMIN, ...extra })).rejects.toBeTruthy();
  });

  it('accepts a BYOW classic account (G…) wallet under the widened CHECK (TOV-243)', async () => {
    const G = 'GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJJRMA';
    await expect(
      events.append(
        [{ batchId: randomUUID(), wallet: G, action: 'add', adminId: ADMIN, txHash: HASH, result: 'confirmed' }],
        dataSource.manager,
      ),
    ).resolves.not.toThrow();
  });

  it('rejects a tx_hash on a non-submitted result (CHK_kae_hash_only_when_submitted)', async () => {
    await expect(
      insertRaw({ batch_id: randomUUID(), wallet: W1, action: 'add', admin_id: ADMIN, result: 'noop', tx_hash: HASH }),
    ).rejects.toBeTruthy();
  });

  it('enforces UNIQUE (batch_id, wallet, action)', async () => {
    const batchId = randomUUID();
    await insertRaw({ batch_id: batchId, wallet: W1, action: 'add', admin_id: ADMIN, result: 'noop' });
    await expect(
      insertRaw({ batch_id: batchId, wallet: W1, action: 'add', admin_id: ADMIN, result: 'noop' }),
    ).rejects.toBeTruthy();
  });

  it('state upsert is last-write-wins on the wallet PK', async () => {
    await state.upsert({ wallet: W1, isAllowed: true, lastAction: 'add', lastTxHash: HASH, lastLedger: 100 }, dataSource.manager);
    await state.upsert({ wallet: W1, isAllowed: false, lastAction: 'remove', lastTxHash: HASH, lastLedger: 150 }, dataSource.manager);
    const rows = await dataSource.query<{ is_allowed: boolean; last_ledger: string }[]>(
      `SELECT is_allowed, last_ledger FROM kyc_allowlist_state WHERE wallet=$1`,
      [W1],
    );
    expect(rows[0].is_allowed).toBe(false);
    expect(rows[0].last_ledger).toBe('150');
  });

  // --- findByWallet (TOV-241) ---
  it('findByWallet returns the mirror row after an upsert, with a string last_ledger', async () => {
    await state.upsert({ wallet: W1, isAllowed: true, lastAction: 'add', lastTxHash: HASH, lastLedger: 100 }, dataSource.manager);
    const row = await state.findByWallet(W1);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({ wallet: W1, isAllowed: true, lastAction: 'add', lastTxHash: HASH, lastLedger: '100' });
    expect(row!.updatedAt).toBeInstanceOf(Date);
  });

  it('findByWallet returns null for an absent (never-seen) wallet', async () => {
    expect(await state.findByWallet(W1)).toBeNull();
  });
});
