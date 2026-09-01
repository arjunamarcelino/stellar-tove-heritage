import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { KycAllowlistState } from '../entities/kyc-allowlist-state.entity';
import {
  IKycAllowlistStateRepository,
  KycAllowlistStateUpsert,
} from './kyc-allowlist-state-repository.interface';

@Injectable()
export class KycAllowlistStateRepository implements IKycAllowlistStateRepository {
  // Injected only for the non-transactional read (TOV-241); `upsert` still runs raw SQL on the caller's manager.
  constructor(
    @InjectRepository(KycAllowlistState)
    private readonly repo: Repository<KycAllowlistState>,
  ) {}

  async findByWallet(wallet: string): Promise<KycAllowlistState | null> {
    return this.repo.findOneBy({ wallet }); // wallet is the natural PK
  }

  async upsert(input: KycAllowlistStateUpsert, manager: EntityManager): Promise<void> {
    // Plain last-write-wins upsert. A monotonic `last_ledger` guard was removed (todo 232): all writes to
    // this mirror come from confirmed submissions that are serialized under the account lock and processed
    // in ledger order within a batch, so an older-ledger write can never arrive after a newer one.
    await manager.query(
      `INSERT INTO "kyc_allowlist_state"
         ("wallet", "is_allowed", "last_action", "last_tx_hash", "last_ledger", "created_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT ("wallet") DO UPDATE SET
         "is_allowed"   = EXCLUDED."is_allowed",
         "last_action"  = EXCLUDED."last_action",
         "last_tx_hash" = EXCLUDED."last_tx_hash",
         "last_ledger"  = EXCLUDED."last_ledger",
         "updated_at"   = now()`,
      [input.wallet, input.isAllowed, input.lastAction, input.lastTxHash, input.lastLedger],
    );
  }
}
