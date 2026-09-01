import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { RegistryEvent } from '../entities/registry-event.entity';
import { IRegistryEventRepository, RegistryEventInsert } from './registry-event-repository.interface';

@Injectable()
export class RegistryEventRepository implements IRegistryEventRepository {
  async recordCustodyTransfer(entry: RegistryEventInsert, manager: EntityManager): Promise<void> {
    // Idempotent append: the FULL-unique `source_ref` lets a bare ON CONFLICT infer the arbiter, so replay
    // (a re-submit) or crash-reconcile of the same item yields exactly one provenance row. Runs in the
    // caller's transaction so it commits atomically with the item-confirm.
    await manager
      .getRepository(RegistryEvent)
      .createQueryBuilder()
      .insert()
      .values({
        eventType: 'custody_transfer',
        userId: entry.userId,
        sourceWalletId: entry.sourceWalletId,
        destinationWalletId: entry.destinationWalletId,
        fromAddress: entry.fromAddress,
        toAddress: entry.toAddress,
        tokenContract: entry.tokenContract,
        amountScaled: entry.amountScaled,
        txHash: entry.txHash,
        ledger: entry.ledger,
        sourceRef: entry.sourceRef,
      })
      .orIgnore()
      .execute();
  }
}
