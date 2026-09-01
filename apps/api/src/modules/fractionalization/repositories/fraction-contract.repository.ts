import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, LessThan } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { FractionContract } from '../entities/fraction-contract.entity';
import {
  DeployedLatch,
  IFractionContractRepository,
} from './fraction-contract-repository.interface';

@Injectable()
export class FractionContractRepository
  extends BaseRepository<FractionContract>
  implements IFractionContractRepository
{
  constructor(dataSource: DataSource) {
    super(FractionContract, dataSource);
  }

  async findActiveByArtworkId(artworkId: string): Promise<FractionContract | null> {
    return this.repository.findOne({
      where: { artworkId, status: In(['deploying', 'deployed']), deletedAt: IsNull() },
    });
  }

  // Batch twin of findActiveByArtworkId for the admin list projection (TOV-240). The partial-unique
  // index guarantees ≤1 active row per artwork, so callers can safely map the result by artworkId.
  async findActiveByArtworkIds(artworkIds: string[]): Promise<FractionContract[]> {
    if (artworkIds.length === 0) return [];
    return this.repository.find({
      where: { artworkId: In(artworkIds), status: In(['deploying', 'deployed']), deletedAt: IsNull() },
    });
  }

  async findAllDeployed(): Promise<FractionContract[]> {
    return this.repository.find({
      where: { status: 'deployed', deletedAt: IsNull() },
    });
  }

  async findLatestByArtworkId(artworkId: string): Promise<FractionContract | null> {
    return this.repository.findOne({
      where: { artworkId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async setTxHash(id: string, txHash: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(FractionContract)
      .set({ txHash, updatedAt: () => 'now()' })
      .where('id = :id', { id })
      .execute();
  }

  async casDeployed(manager: EntityManager, id: string, latch: DeployedLatch): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(FractionContract)
      .set({
        status: 'deployed',
        tokenAddress: latch.tokenAddress,
        deployLedger: latch.deployLedger,
        artistRetentionAmount: latch.artistRetentionAmount,
        treasuryRetentionAmount: latch.treasuryRetentionAmount,
        artistLockupUntil: latch.artistLockupUntil,
        updatedAt: () => 'now()',
      })
      .where('id = :id AND status = :from', { id, from: 'deploying' })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async casFailed(manager: EntityManager, id: string): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(FractionContract)
      .set({ status: 'failed', updatedAt: () => 'now()' })
      .where('id = :id AND status = :from', { id, from: 'deploying' })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async findStaleDeploying(graceMs: number, limit: number): Promise<FractionContract[]> {
    const cutoff = new Date(Date.now() - graceMs);
    return this.repository.find({
      where: { status: 'deploying', deletedAt: IsNull(), createdAt: LessThan(cutoff) },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }
}
