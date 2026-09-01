import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { createTestingModule, truncateTables } from '../../setup';
import { WalletRotationTransfer } from '../../../../src/modules/wallets/rotation/entities/wallet-rotation-transfer.entity';
import { WalletRotationTransferItem } from '../../../../src/modules/wallets/rotation/entities/wallet-rotation-transfer-item.entity';
import { RegistryEvent } from '../../../../src/modules/wallets/rotation/entities/registry-event.entity';
import {
  WALLET_ROTATION_REPOSITORY,
  IWalletRotationRepository,
} from '../../../../src/modules/wallets/rotation/repositories/wallet-rotation-repository.interface';
import { WalletRotationRepository } from '../../../../src/modules/wallets/rotation/repositories/wallet-rotation.repository';
import {
  REGISTRY_EVENT_REPOSITORY,
  IRegistryEventRepository,
} from '../../../../src/modules/wallets/rotation/repositories/registry-event-repository.interface';
import { RegistryEventRepository } from '../../../../src/modules/wallets/rotation/repositories/registry-event.repository';

const SOURCE_ADDR = 'C' + 'A'.repeat(55);
const DEST_ADDR = 'G' + 'B'.repeat(55);
const TOKEN = 'C' + 'D'.repeat(55);

@Module({
  imports: [TypeOrmModule.forFeature([WalletRotationTransfer, WalletRotationTransferItem, RegistryEvent])],
  providers: [
    { provide: WALLET_ROTATION_REPOSITORY, useClass: WalletRotationRepository },
    { provide: REGISTRY_EVENT_REPOSITORY, useClass: RegistryEventRepository },
  ],
})
class RotationTestModule {}

describe('wallet rotation (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let repo: IWalletRotationRepository;
  let registry: IRegistryEventRepository;
  let userId: string;
  let sourceWalletId: string;
  let destWalletId: string;

  beforeAll(async () => {
    moduleRef = await createTestingModule(WalletsModule, RotationTestModule);
    dataSource = moduleRef.get(DataSource);
    repo = moduleRef.get(WALLET_ROTATION_REPOSITORY);
    registry = moduleRef.get(REGISTRY_EVENT_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
    const [{ id: uid }] = await dataSource.query<{ id: string }[]>(`INSERT INTO users DEFAULT VALUES RETURNING id`);
    userId = uid;
    const [{ id: sid }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO wallets (user_id, kind, contract_address) VALUES ($1, 'embedded_passkey', $2) RETURNING id`,
      [userId, SOURCE_ADDR],
    );
    sourceWalletId = sid;
    const [{ id: did }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO wallets (user_id, kind, public_key, is_primary) VALUES ($1, 'byow', $2, true) RETURNING id`,
      [userId, DEST_ADDR],
    );
    destWalletId = did;
  });

  const createRotation = () => repo.createRotation(sourceWalletId, userId, destWalletId, DEST_ADDR);

  it('enforces one active rotation per source wallet (UQ_wrt_source_active)', async () => {
    await createRotation();
    let caught: unknown;
    try {
      await createRotation();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(isUniqueConstraintError(caught)).toBe(true);
  });

  it('softCancel clears the latch so a fresh rotation can be created', async () => {
    const first = await createRotation();
    await repo.softCancel(first.id);
    // The partial unique index is WHERE deleted_at IS NULL — the soft-deleted row no longer blocks.
    const second = await createRotation();
    expect(second.id).not.toBe(first.id);
  });

  it('claimItemForSubmit is a single-writer CAS', async () => {
    const rotation = await createRotation();
    const item = await repo.upsertItemBuild({
      rotationId: rotation.id,
      tokenContract: TOKEN,
      amountScaled: '100',
      unsignedTxXdr: 'xdr',
      expiresAtLedger: 1000,
    });
    expect(await repo.claimItemForSubmit(item.id)).toBe(true);
    expect(await repo.claimItemForSubmit(item.id)).toBe(false); // already 'submitted'
  });

  it('upsertItemBuild is idempotent per (rotation, token) — one item, never a duplicate (todo 428)', async () => {
    const rotation = await createRotation();
    const build = () =>
      repo.upsertItemBuild({
        rotationId: rotation.id,
        tokenContract: TOKEN,
        amountScaled: '100',
        unsignedTxXdr: 'xdr',
        expiresAtLedger: 1000,
      });
    const a = await build();
    const b = await build(); // a "fresh build" for the same token must reuse the row, not insert a 2nd
    expect(b.id).toBe(a.id);
    const rows = await dataSource.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM wallet_rotation_transfer_items WHERE rotation_id = $1 AND token_contract = $2`,
      [rotation.id, TOKEN],
    );
    expect(rows[0].n).toBe(1);
    // A raw duplicate insert (simulating a concurrent racer) is rejected by UQ_wrti_rotation_token.
    await expect(
      dataSource.query(
        `INSERT INTO wallet_rotation_transfer_items (rotation_id, token_contract, amount_scaled, status)
         VALUES ($1, $2, '100', 'pending')`,
        [rotation.id, TOKEN],
      ),
    ).rejects.toThrow();
  });

  it('a soft-canceled item can no longer be claimed for submit (cancel-vs-claim race) (todo 436)', async () => {
    const rotation = await createRotation();
    const item = await repo.upsertItemBuild({
      rotationId: rotation.id,
      tokenContract: TOKEN,
      amountScaled: '100',
      unsignedTxXdr: 'xdr',
      expiresAtLedger: 1000,
    });
    await repo.softCancel(rotation.id); // concurrent cancel soft-deletes the parent + items
    // The claim's `deleted_at IS NULL` predicate must refuse the canceled item → no money moves.
    expect(await repo.claimItemForSubmit(item.id)).toBe(false);
  });

  it('markItemConfirmed writes exactly one custody_transfer row, idempotent under replay (source_ref)', async () => {
    const rotation = await createRotation();
    const item = await repo.upsertItemBuild({
      rotationId: rotation.id,
      tokenContract: TOKEN,
      amountScaled: '100',
      unsignedTxXdr: 'xdr',
      expiresAtLedger: 1000,
    });
    const entry = {
      userId,
      sourceWalletId,
      destinationWalletId: destWalletId,
      fromAddress: SOURCE_ADDR,
      toAddress: DEST_ADDR,
      tokenContract: TOKEN,
      amountScaled: '100',
      txHash: 'a'.repeat(64),
      ledger: 42,
      sourceRef: `rotation_item:${item.id}`,
    };
    await repo.markItemConfirmed(item.id, 'a'.repeat(64), 42, (m) => registry.recordCustodyTransfer(entry, m));
    // Replay the SAME provenance row (e.g. a reconcile) — ON CONFLICT (source_ref) DO NOTHING.
    await dataSource.transaction((m) => registry.recordCustodyTransfer(entry, m));

    const rows = await dataSource.query<{ event_type: string; amount_scaled: string }[]>(`SELECT event_type, amount_scaled FROM registry_events WHERE source_ref = $1`, [
      `rotation_item:${item.id}`,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('custody_transfer');
  });

  it('registry_events is append-only (UPDATE and DELETE are rejected)', async () => {
    const rotation = await createRotation();
    const item = await repo.upsertItemBuild({
      rotationId: rotation.id,
      tokenContract: TOKEN,
      amountScaled: '100',
      unsignedTxXdr: 'xdr',
      expiresAtLedger: 1000,
    });
    await dataSource.transaction((m) =>
      registry.recordCustodyTransfer(
        {
          userId,
          sourceWalletId,
          destinationWalletId: destWalletId,
          fromAddress: SOURCE_ADDR,
          toAddress: DEST_ADDR,
          tokenContract: TOKEN,
          amountScaled: '100',
          txHash: null,
          ledger: null,
          sourceRef: `rotation_item:${item.id}`,
        },
        m,
      ),
    );
    await expect(dataSource.query(`UPDATE registry_events SET amount_scaled = '1'`)).rejects.toThrow(/append-only/);
    await expect(dataSource.query(`DELETE FROM registry_events`)).rejects.toThrow(/append-only/);
  });

  it('finalizeIfAllConfirmed completes the rotation when every item is confirmed + balances zero', async () => {
    const rotation = await createRotation();
    const item = await repo.upsertItemBuild({
      rotationId: rotation.id,
      tokenContract: TOKEN,
      amountScaled: '100',
      unsignedTxXdr: 'xdr',
      expiresAtLedger: 1000,
    });
    await repo.markItemConfirmed(item.id, 'b'.repeat(64), 7, async () => {});
    const completed = await repo.finalizeIfAllConfirmed(rotation.id, sourceWalletId, true, async () => {});
    expect(completed).toBe(true);

    const [row] = await dataSource.query<{ status: string; completed_at: string | null }[]>(`SELECT status, completed_at FROM wallet_rotation_transfers WHERE id = $1`, [
      rotation.id,
    ]);
    expect(row.status).toBe('completed');
    expect(row.completed_at).not.toBeNull();
  });

  it('finalizeIfAllConfirmed does NOT demote an already-completed rotation (no CHECK violation) (todo 430)', async () => {
    const rotation = await createRotation();
    const item = await repo.upsertItemBuild({
      rotationId: rotation.id,
      tokenContract: TOKEN,
      amountScaled: '100',
      unsignedTxXdr: 'xdr',
      expiresAtLedger: 1000,
    });
    await repo.markItemConfirmed(item.id, 'c'.repeat(64), 9, async () => {});
    expect(await repo.finalizeIfAllConfirmed(rotation.id, sourceWalletId, true, async () => {})).toBe(true);

    // A re-finalize with allBalancesZero=false (e.g. a re-submit whose live re-read failed) must be a no-op,
    // NOT `UPDATE completed→submitting` (which would violate CHK_wrt_completed_at → 500).
    await expect(repo.finalizeIfAllConfirmed(rotation.id, sourceWalletId, false, async () => {})).resolves.toBe(false);
    const [row] = await dataSource.query<{ status: string }[]>(`SELECT status FROM wallet_rotation_transfers WHERE id = $1`, [rotation.id]);
    expect(row.status).toBe('completed');
  });
});
