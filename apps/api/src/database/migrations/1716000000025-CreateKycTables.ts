import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KYC submission + encrypted document storage (TOV-28, FR-01.07). Three parts:
 *
 *  (1) `users.kyc_status` — collector KYC lifecycle. `NOT NULL DEFAULT 'not_submitted'` is a fast
 *      catalog-only add (PG11+; no table rewrite). The CHECK is added `NOT VALID` then `VALIDATE`d
 *      (house convention …011/…012/…016) to keep the lock at SHARE UPDATE EXCLUSIVE. varchar+CHECK, not
 *      a native PG enum (the codebase has zero native enums — avoids `ALTER TYPE … ADD VALUE` pain).
 *
 *  (2) `kyc_submissions` — one row per submit. FK to `users` is `ON DELETE RESTRICT` (a collector with
 *      KYC history cannot be hard-deleted). At most one live `pending_review` per user is enforced by the
 *      partial-unique index `UQ_kyc_submissions_one_pending_per_user` — predicate keyed on
 *      `status='pending_review' AND deleted_at IS NULL` so a `rejected`/soft-deleted row does NOT block a
 *      resubmit. This index is the durable race backstop (a lost 409 surfaces as 23505 on THIS name).
 *
 *  (3) `kyc_documents` — the four encrypted documents. FK to `kyc_submissions` is **`ON DELETE RESTRICT`**
 *      (NOT cascade): 7-year retention means a submission must never be hard-deleted while its documents
 *      exist. At-rest CHECKs pin the envelope invariants for a decade (RFC-3394-shaped 40-byte wrapped DEK,
 *      lowercase-hex blob_hash, allowed MIME set, 1..10MB size). `storage_key` (NOT `r2_key`) — storage is
 *      Supabase, not R2.
 *
 * This is a soft-delete domain, so both tables get partial indexes `WHERE deleted_at IS NULL`.
 */
export class CreateKycTables1716000000025 implements MigrationInterface {
  name = 'CreateKycTables1716000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // (1) users.kyc_status — fast catalog-only add, then NOT VALID → VALIDATE CHECK.
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "kyc_status" varchar(16) NOT NULL DEFAULT 'not_submitted'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_kyc_status" ` +
        `CHECK ("kyc_status" IN ('not_submitted','pending_review','approved','rejected')) NOT VALID`,
    );
    await queryRunner.query(`ALTER TABLE "users" VALIDATE CONSTRAINT "CHK_users_kyc_status"`);

    // (2) kyc_submissions.
    await queryRunner.query(`
      CREATE TABLE "kyc_submissions" (
        "id"                       uuid        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                  uuid        NOT NULL,
        "status"                   varchar(16) NOT NULL,
        "claimed_jurisdiction"     char(2)     NOT NULL,
        "supersedes_submission_id" uuid,
        "created_at"               timestamptz NOT NULL DEFAULT now(),
        "updated_at"               timestamptz NOT NULL DEFAULT now(),
        "deleted_at"               timestamptz,
        CONSTRAINT "PK_kyc_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kyc_submissions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_kyc_submissions_supersedes" FOREIGN KEY ("supersedes_submission_id")
          REFERENCES "kyc_submissions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_kyc_submissions_status"
          CHECK ("status" IN ('pending_review','approved','rejected')),
        CONSTRAINT "CHK_kyc_submissions_jurisdiction"
          CHECK ("claimed_jurisdiction" ~ '^[A-Z]{2}$')
      )
    `);

    // The race backstop: at most one live pending submission per user. Predicate is pending-only so a
    // rejected/soft-deleted row never blocks a resubmit.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_kyc_submissions_one_pending_per_user"
        ON "kyc_submissions" ("user_id")
        WHERE "status" = 'pending_review' AND "deleted_at" IS NULL
    `);
    // Newest-first per-user reads (status read + prior-rejected lookup); also serves the user_id FK scans.
    await queryRunner.query(`
      CREATE INDEX "IDX_kyc_submissions_user_created"
        ON "kyc_submissions" ("user_id", "created_at" DESC)
        WHERE "deleted_at" IS NULL
    `);

    // (3) kyc_documents.
    await queryRunner.query(`
      CREATE TABLE "kyc_documents" (
        "id"              uuid        NOT NULL DEFAULT gen_random_uuid(),
        "submission_id"   uuid        NOT NULL,
        "doc_type"        varchar(24) NOT NULL,
        "storage_key"     text        NOT NULL,
        "encrypted_dek"   bytea       NOT NULL,
        "dek_key_version" smallint    NOT NULL,
        "blob_hash"       char(64)    NOT NULL,
        "content_type"    varchar(64) NOT NULL,
        "byte_size"       integer     NOT NULL,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        "updated_at"      timestamptz NOT NULL DEFAULT now(),
        "deleted_at"      timestamptz,
        CONSTRAINT "PK_kyc_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kyc_documents_submission" FOREIGN KEY ("submission_id")
          REFERENCES "kyc_submissions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_kyc_documents_doc_type"
          CHECK ("doc_type" IN ('gov_id_front','gov_id_back','proof_of_address','selfie')),
        CONSTRAINT "CHK_kyc_documents_dek_version" CHECK ("dek_key_version" >= 1),
        -- AES-256-GCM wrap of a 32-byte DEK: iv(12) ‖ tag(16) ‖ ciphertext(32) = 60 bytes (SEC-C1).
        CONSTRAINT "CHK_kyc_documents_dek_len" CHECK (octet_length("encrypted_dek") = 60),
        CONSTRAINT "CHK_kyc_documents_blob_hash" CHECK ("blob_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_kyc_documents_content_type"
          CHECK ("content_type" IN ('image/jpeg','image/png','application/pdf')),
        CONSTRAINT "CHK_kyc_documents_byte_size" CHECK ("byte_size" > 0 AND "byte_size" <= 10485760)
      )
    `);
    // One row per (submission, doc_type).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_kyc_documents_submission_doctype"
        ON "kyc_documents" ("submission_id", "doc_type")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ⚠️ DATA LOSS: dropping these tables destroys 7-year-retention-obligated KYC PII. Fail-closed in
    // production regardless of ALLOW_DESTRUCTIVE_DOWN — schema revert is never acceptable once real
    // submissions exist (roll back the CODE instead; the added column/tables are forward-compatible).
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Refusing to revert CreateKycTables1716000000025 in production: dropping "kyc_submissions"/' +
          '"kyc_documents" destroys retention-obligated KYC PII. Roll back the deployment instead.',
      );
    }
    // Drop in dependency order: documents (child) → submissions (parent + self-FK) → users column.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_kyc_documents_submission_doctype"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kyc_documents"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kyc_submissions_user_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_kyc_submissions_one_pending_per_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kyc_submissions"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "CHK_users_kyc_status"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "kyc_status"`);
  }
}
