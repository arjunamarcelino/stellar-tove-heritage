import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';

/**
 * A Collector's inheritance beneficiary designation (TOV-31, FR-01.10) — one active row per Collector,
 * enforced by the partial-unique index `UQ_beneficiaries_user_active (user_id) WHERE deleted_at IS NULL`.
 *
 * Holds a THIRD party's PII (`name`/`email`/`notes`). Removal (owner `DELETE` + account-erasure) is a
 * **hard delete** so that PII is physically purged — the `internal_audit_log` retains the *fact* of the
 * change (no PII), so no soft-deleted skeleton is needed. The inherited `deleted_at` column therefore
 * stays `NULL` in practice; it exists only so this entity conforms to `BaseEntity` (and TypeORM's
 * soft-delete scoping is a harmless no-op — every live row has `deleted_at IS NULL`).
 *
 * Never serialized to a client directly — `BeneficiaryResponseDto.build` maps field-by-field so
 * `user_id`/`deleted_at` never leak.
 */
@Entity('beneficiaries')
export class Beneficiary extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'name', type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'email', type: 'varchar', length: 320 })
  email!: string;

  // Case-sensitive Stellar G-address — never normalized (unlike email). Absent ⇒ null.
  @Column({ name: 'stellar_pubkey', type: 'varchar', length: 56, nullable: true })
  stellarPubkey!: string | null;

  @Column({ name: 'relationship', type: 'varchar', length: 64, nullable: true })
  relationship!: string | null;

  @Column({ name: 'notes', type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;
}
