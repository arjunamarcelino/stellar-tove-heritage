import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/**
 * Append-only ledger of every handle a collector has held (TOV-27, FR-01.06). Deliberately does NOT
 * extend `BaseEntity`: an immutable event row has no `updated_at`/`deleted_at`, and a DB trigger
 * (migration …024) forbids UPDATE. `HandleService.setHandle` appends the NEW handle on every real
 * change; `CollectorsService` reads these newest-first, excludes the current canonical, and dedups.
 */
@Entity('handle_history')
export class HandleHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // Collector-typed display casing (validated 3–24 upstream; varchar(24) is the length backstop).
  @Column({ type: 'varchar', length: 24 })
  handle!: string;

  // DB-GENERATED (`GENERATED ALWAYS AS (lower(handle)) STORED`, see migration …024). Modelled read-only
  // exactly like User.handleCanonical: insert/update:false so TypeORM never writes it (Postgres rejects
  // writes to a generated column), select stays true. `yarn migration:generate` will perpetually report
  // drift here (it can't see the GENERATED clause) — discard that diff; do NOT add generatedType/asExpression
  // (migrations own the DDL). NOTE the same staleness caveat: after a raw `manager.insert` this field is NOT
  // hydrated in memory — only `find()` populates it. Never `save()` this entity and read `handleCanonical` back.
  @Column({ name: 'handle_canonical', type: 'text', insert: false, update: false })
  handleCanonical!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
