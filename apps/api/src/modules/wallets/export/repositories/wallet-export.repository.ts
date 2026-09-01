import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { Wallet } from '../../entities/wallet.entity';
import { WalletExport } from '../entities/wallet-export.entity';
import { WalletExportItem } from '../entities/wallet-export-item.entity';
import { IWalletExportRepository, ItemBuildInput } from './wallet-export-repository.interface';

@Injectable()
export class WalletExportRepository
  extends BaseRepository<WalletExport>
  implements IWalletExportRepository
{
  constructor(dataSource: DataSource) {
    super(WalletExport, dataSource);
  }

  async findActiveByWalletIdWithItems(walletId: string): Promise<WalletExport | null> {
    // Non-completed = the single active export the partial unique index guarantees (live rows only).
    return this.repository.findOne({
      where: { walletId, status: Not('completed') },
      relations: { items: true },
    });
  }

  async findOwnedWithItems(
    exportId: string,
    walletId: string,
    userId: string,
  ): Promise<WalletExport | null> {
    // Ownership is a hard predicate (IDOR guard): id AND wallet AND user must all match.
    return this.repository.findOne({
      where: { id: exportId, walletId, userId },
      relations: { items: true },
    });
  }

  async findLatestByWalletIdWithItems(walletId: string): Promise<WalletExport | null> {
    return this.repository.findOne({
      where: { walletId },
      relations: { items: true },
      order: { createdAt: 'DESC' },
    });
  }

  async createExport(walletId: string, userId: string, targetAddress: string): Promise<WalletExport> {
    const exp = this.repository.create({ walletId, userId, targetAddress, status: 'pending' });
    return this.repository.save(exp);
  }

  async upsertItemBuild(input: ItemBuildInput): Promise<WalletExportItem> {
    const items = this.dataSourceRef.getRepository(WalletExportItem);
    const item = input.existingId
      ? await items.findOneByOrFail({ id: input.existingId })
      : items.create({ exportId: input.exportId, tokenContract: input.tokenContract });
    item.tokenKind = input.tokenKind;
    item.amountScaled = input.amountScaled;
    item.unsignedTxXdr = input.unsignedTxXdr;
    item.expiresAtLedger = input.expiresAtLedger;
    item.status = 'pending';
    item.lastErrorCode = null;
    return items.save(item);
  }

  async claimItemForSubmit(itemId: string): Promise<boolean> {
    // Single-writer per item: only a pending/failed item can be claimed; the winner flips it to
    // 'submitted'. A concurrent submit that finds it already 'submitted'/'confirmed' affects 0 rows and
    // must skip (never re-send the same item).
    const result = await this.dataSourceRef
      .getRepository(WalletExportItem)
      .update({ id: itemId, status: In(['pending', 'failed']) }, { status: 'submitted' });
    return (result.affected ?? 0) > 0;
  }

  async markItemConfirmed(itemId: string, txHash: string, ledger: number): Promise<void> {
    await this.dataSourceRef
      .getRepository(WalletExportItem)
      .update({ id: itemId }, { status: 'confirmed', txHash, ledger, lastErrorCode: null });
  }

  async reconcileItemConfirmed(itemId: string): Promise<boolean> {
    const result = await this.dataSourceRef
      .getRepository(WalletExportItem)
      .update({ id: itemId, status: 'submitted' }, { status: 'confirmed', lastErrorCode: null });
    return (result.affected ?? 0) > 0;
  }

  async markItemFailed(itemId: string, errorCode: string): Promise<void> {
    await this.dataSourceRef
      .getRepository(WalletExportItem)
      .update({ id: itemId }, { status: 'failed', lastErrorCode: errorCode });
  }

  async finalizeIfAllConfirmed(
    exportId: string,
    walletId: string,
    allBalancesZero: boolean,
    latchWallet: (manager: EntityManager) => Promise<boolean>,
    onConfirm: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean> {
    return this.runInTransaction(async (manager) => {
      // Serialize all mutations for this wallet — the authoritative guard against a concurrent submit /
      // resume marking the wallet exported while an item is still pending.
      await manager.getRepository(Wallet).findOne({
        where: { id: walletId },
        lock: { mode: 'pessimistic_write' },
      });

      // One conditional aggregate (total + non-confirmed) instead of two COUNTs — shorter hold on the
      // wallet-row lock (todo 138).
      const counts = await manager
        .getRepository(WalletExportItem)
        .createQueryBuilder('i')
        .select('COUNT(*)', 'total')
        .addSelect("COUNT(*) FILTER (WHERE i.status <> 'confirmed')", 'remaining')
        .where('i.export_id = :exportId', { exportId })
        .getRawOne<{ total: string; remaining: string }>();
      const total = Number(counts?.total ?? 0);
      const remaining = Number(counts?.remaining ?? 0);

      // Latch exported ONLY if the DB re-count agrees AND the live-balance-zero gate passed. The Wallet
      // write itself routes through the wallets aggregate's own guarded transition (latchWallet).
      if (total > 0 && remaining === 0 && allBalancesZero) {
        const latched = await latchWallet(manager);
        await manager
          .getRepository(WalletExport)
          .update({ id: exportId }, { status: 'completed', completedAt: new Date() });
        await onConfirm(manager);
        return latched;
      }

      await manager.getRepository(WalletExport).update({ id: exportId }, { status: 'submitting' });
      return false;
    });
  }

  /** The DataSource captured by BaseRepository, for cross-entity (item) access within this aggregate. */
  private get dataSourceRef(): DataSource {
    return this.repository.manager.connection;
  }
}
