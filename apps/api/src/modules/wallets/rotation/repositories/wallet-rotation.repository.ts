import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { Wallet } from '../../entities/wallet.entity';
import { WalletRotationTransfer } from '../entities/wallet-rotation-transfer.entity';
import { WalletRotationTransferItem } from '../entities/wallet-rotation-transfer-item.entity';
import { IWalletRotationRepository, RotationItemBuildInput } from './wallet-rotation-repository.interface';

@Injectable()
export class WalletRotationRepository
  extends BaseRepository<WalletRotationTransfer>
  implements IWalletRotationRepository
{
  constructor(dataSource: DataSource) {
    super(WalletRotationTransfer, dataSource);
  }

  async findActiveBySourceWithItems(sourceWalletId: string): Promise<WalletRotationTransfer | null> {
    // Non-completed = the single active rotation the partial unique index guarantees (live rows only).
    return this.repository.findOne({
      where: { sourceWalletId, status: Not('completed') },
      relations: { items: true },
    });
  }

  async findOwnedWithItems(
    rotationId: string,
    sourceWalletId: string,
    userId: string,
  ): Promise<WalletRotationTransfer | null> {
    // Ownership is a hard predicate (IDOR guard): id AND source wallet AND user must all match.
    return this.repository.findOne({
      where: { id: rotationId, sourceWalletId, userId },
      relations: { items: true },
    });
  }

  async findLatestBySourceWithItems(sourceWalletId: string): Promise<WalletRotationTransfer | null> {
    return this.repository.findOne({
      where: { sourceWalletId },
      relations: { items: true },
      order: { createdAt: 'DESC' },
    });
  }

  async createRotation(
    sourceWalletId: string,
    userId: string,
    destinationWalletId: string,
    destinationAddress: string,
  ): Promise<WalletRotationTransfer> {
    const rotation = this.repository.create({
      sourceWalletId,
      userId,
      destinationWalletId,
      destinationAddress,
      status: 'pending',
    });
    return this.repository.save(rotation);
  }

  async upsertItemBuild(input: RotationItemBuildInput): Promise<WalletRotationTransferItem> {
    const items = this.dataSourceRef.getRepository(WalletRotationTransferItem);
    const apply = (row: WalletRotationTransferItem): WalletRotationTransferItem => {
      row.amountScaled = input.amountScaled;
      row.unsignedTxXdr = input.unsignedTxXdr;
      row.expiresAtLedger = input.expiresAtLedger;
      row.status = 'pending';
      row.lastErrorCode = null;
      return row;
    };
    // Find-or-create by (rotation, token) — `UQ_wrti_rotation_token` (todo 428) makes one item per token
    // authoritative even under concurrent initiate. Resume passes existingId; a fresh build looks up by key.
    const existing = input.existingId
      ? await items.findOneByOrFail({ id: input.existingId })
      : await items.findOneBy({ rotationId: input.rotationId, tokenContract: input.tokenContract });
    if (existing) return items.save(apply(existing));
    try {
      return await items.save(apply(items.create({ rotationId: input.rotationId, tokenContract: input.tokenContract })));
    } catch (err) {
      // A concurrent initiate inserted the same (rotation, token) between the lookup and this save — re-read
      // the winner and apply onto it (no duplicate item, so no duplicate custody_transfer row downstream).
      if (!isUniqueConstraintError(err)) throw err;
      const winner = await items.findOneByOrFail({ rotationId: input.rotationId, tokenContract: input.tokenContract });
      return items.save(apply(winner));
    }
  }

  async claimItemForSubmit(itemId: string): Promise<boolean> {
    // Single-writer per item: only a LIVE pending/failed item can be claimed; the winner flips it to
    // 'submitted'. A concurrent submit that finds it already 'submitted'/'confirmed' affects 0 rows. The
    // `deleted_at IS NULL` predicate closes the cancel-vs-claim race (todo 436 #1): a concurrent `cancel`
    // soft-deletes the item, so it can no longer be claimed here and no money moves against a canceled rotation.
    const result = await this.dataSourceRef
      .getRepository(WalletRotationTransferItem)
      .update({ id: itemId, status: In(['pending', 'failed']), deletedAt: IsNull() }, { status: 'submitted' });
    return (result.affected ?? 0) > 0;
  }

  async markItemConfirmed(
    itemId: string,
    txHash: string,
    ledger: number,
    onConfirmed: (manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    await this.runInTransaction(async (manager) => {
      await manager
        .getRepository(WalletRotationTransferItem)
        .update({ id: itemId }, { status: 'confirmed', txHash, ledger, lastErrorCode: null });
      // The custody_transfer provenance row commits atomically with the confirm (idempotent).
      await onConfirmed(manager);
    });
  }

  async reconcileItemConfirmed(
    itemId: string,
    onConfirmed: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean> {
    return this.runInTransaction(async (manager) => {
      // Promote a crash-stuck `submitted` OR a false-negative `failed` item (the tx actually landed but the
      // relayer errored after send) whose balance is verifiably drained — C4. Guarded to those two states.
      const result = await manager
        .getRepository(WalletRotationTransferItem)
        .update({ id: itemId, status: In(['submitted', 'failed']) }, { status: 'confirmed', lastErrorCode: null });
      if ((result.affected ?? 0) === 0) return false;
      await onConfirmed(manager);
      return true;
    });
  }

  async markItemFailed(itemId: string, errorCode: string): Promise<void> {
    await this.dataSourceRef
      .getRepository(WalletRotationTransferItem)
      .update({ id: itemId }, { status: 'failed', lastErrorCode: errorCode });
  }

  async finalizeIfAllConfirmed(
    rotationId: string,
    sourceWalletId: string,
    allBalancesZero: boolean,
    onConfirm: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean> {
    return this.runInTransaction(async (manager) => {
      // Serialize all mutations for this source wallet — the authoritative guard against a concurrent
      // submit/resume completing the rotation while an item is still pending.
      await manager.getRepository(Wallet).findOne({
        where: { id: sourceWalletId },
        lock: { mode: 'pessimistic_write' },
      });

      const counts = await manager
        .getRepository(WalletRotationTransferItem)
        .createQueryBuilder('i')
        .select('COUNT(*)', 'total')
        .addSelect("COUNT(*) FILTER (WHERE i.status <> 'confirmed')", 'remaining')
        .where('i.rotation_id = :rotationId', { rotationId })
        .andWhere('i.deleted_at IS NULL')
        .getRawOne<{ total: string; remaining: string }>();
      const total = Number(counts?.total ?? 0);
      const remaining = Number(counts?.remaining ?? 0);

      // Complete ONLY if the DB re-count agrees AND the live-balance-zero gate passed.
      if (total > 0 && remaining === 0 && allBalancesZero) {
        await manager
          .getRepository(WalletRotationTransfer)
          .update({ id: rotationId }, { status: 'completed', completedAt: new Date() });
        await onConfirm(manager);
        return true;
      }

      // Guard the demotion against an ALREADY-completed row (a re-submit whose live re-read threw would else
      // set completed→submitting, violating CHK_wrt_completed_at → an unhandled 500). status<>'completed' makes
      // it a no-op on a terminal row (todo 430); a completed rotation is reported as already done by the caller.
      await manager
        .getRepository(WalletRotationTransfer)
        .update({ id: rotationId, status: Not('completed') }, { status: 'submitting' });
      return false;
    });
  }

  async softCancel(rotationId: string): Promise<void> {
    // Soft-delete the parent + its items in one tx — clears the one-active latch (the partial unique index
    // is `WHERE deleted_at IS NULL`), letting the user retarget or fall back to export.
    await this.runInTransaction(async (manager) => {
      await manager.getRepository(WalletRotationTransferItem).softDelete({ rotationId });
      await manager.getRepository(WalletRotationTransfer).softDelete({ id: rotationId });
    });
  }

  /** The DataSource captured by BaseRepository, for cross-entity (item) access within this aggregate. */
  private get dataSourceRef(): DataSource {
    return this.repository.manager.connection;
  }
}
