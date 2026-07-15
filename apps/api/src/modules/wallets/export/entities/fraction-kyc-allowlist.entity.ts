import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';

/**
 * KYC-allowlisted destination addresses for embedded-wallet export (FR-01.02c). A collector may only
 * export ("graduate") their smart-wallet holdings to an address present here — the off-chain mirror of
 * the on-chain `KYCAllowlist.is_allowed(addr)` (TOV-141). TOV-40 is READ-ONLY over this table; rows are
 * seeded/removed by the KYC review flow (owned elsewhere). Soft-deletable so a revocation is auditable
 * and the same address can be re-added later without colliding (partial unique over live rows).
 */
@Entity('fraction_kyc_allowlist')
export class FractionKycAllowlist extends BaseEntity {
  // Canonical Stellar StrKey (G... or C...). Stored case-exact (StrKey is canonical base32; never lowercased).
  @Column({ name: 'target_address', type: 'varchar', length: 56 })
  targetAddress!: string;

  // Optional operator note (who/why added); not used for validation.
  @Column({ type: 'text', nullable: true })
  note: string | null = null;
}
