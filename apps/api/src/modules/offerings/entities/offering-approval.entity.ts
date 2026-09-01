import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';

/**
 * One append-only row per `(offering_id, admin_sub)` approval "signature" for the TOV-154 app-level
 * 2-of-3 quorum (FR-05.02). A rostered admin's `POST …/approve` inserts one row; quorum =
 * `COUNT(*) of live rows whose admin_sub ∈ OFFERING_APPROVAL_SIGNERS >= THRESHOLD`. The partial-unique
 * index `UQ_offering_approvals_signer (offering_id, admin_sub) WHERE deleted_at IS NULL` guarantees at
 * most one live row per signer (the double-count guard + the quorum-count read path). Rows are
 * append-only + soft-delete-final at the DB layer (BEFORE UPDATE/DELETE trigger, migration): only a
 * one-way `deleted_at NULL → timestamp` is allowed (expiry sweep, or the deploy-success cleanup).
 */
@Entity({ name: 'offering_approvals' })
export class OfferingApproval extends BaseEntity {
  @Column({ name: 'offering_id', type: 'uuid' })
  offeringId!: string;

  /** The verified admin JWT `sub` of the approver. Intentionally no FK (audit-actor semantics). */
  @Column({ name: 'admin_sub', type: 'uuid' })
  adminSub!: string;
}
