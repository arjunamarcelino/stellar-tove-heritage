import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { Wallet } from '../entities/wallet.entity';
import { IWalletRepository } from './wallet-repository.interface';

@Injectable()
export class WalletRepository extends BaseRepository<Wallet> implements IWalletRepository {
  private readonly logger = new Logger(WalletRepository.name);

  constructor(dataSource: DataSource) {
    super(Wallet, dataSource);
  }

  async findByPublicKey(publicKey: string): Promise<Wallet | null> {
    return this.repository.findOne({
      where: { publicKey },
      relations: { user: true },
    });
  }

  async findEmbeddedWalletByUserId(userId: string): Promise<Wallet | null> {
    // Live rows only (TypeORM excludes soft-deleted by default) and kind-scoped, so a byow-only
    // caller — or a caller whose embedded wallet was soft-deleted — resolves to null.
    // Deterministic (oldest first) + defensive: `UQ_wallets_user_embedded_active` enforces at most
    // one live row, but if that invariant is ever violated, warn and pick the oldest rather than
    // silently resolving an arbitrary wallet for a money transfer.
    const rows = await this.repository.find({
      where: { userId, kind: 'embedded_passkey' },
      order: { createdAt: 'ASC' },
      take: 2,
    });
    if (rows.length > 1) {
      this.logger.warn(`multiple live embedded wallets for user [user=${userId}] — using the oldest`);
    }
    return rows[0] ?? null;
  }

  async findAllByUserId(userId: string): Promise<Wallet[]> {
    return this.repository.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async findAnyByPublicKey(publicKey: string): Promise<Wallet | null> {
    return this.repository.findOne({
      where: { publicKey },
      relations: { user: true },
      withDeleted: true,
    });
  }

  async restore(wallet: Wallet): Promise<Wallet> {
    return this.repository.recover(wallet);
  }

  async findOwnedById(walletId: string, userId: string): Promise<Wallet | null> {
    // Live rows only (TypeORM excludes soft-deleted); any export status so an already-exported wallet
    // resolves (→ EXPORT_NOT_AVAILABLE) rather than a misleading 404.
    return this.repository.findOne({ where: { id: walletId, userId } });
  }

  async markExported(walletId: string, manager: EntityManager): Promise<boolean> {
    // Idempotent + guarded: only an `active` row flips, and status + removed_at move together to satisfy
    // CHK_wallets_exported_removed_at. Runs inside the caller's tx (which holds the wallet row lock).
    const result = await manager
      .getRepository(Wallet)
      .update({ id: walletId, status: 'active' }, { status: 'exported', removedAt: new Date() });
    return (result.affected ?? 0) > 0;
  }
}
