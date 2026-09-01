import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persisted artworks source-of-truth for fractionalization (TOV-233, FR-04.MVP.01). The public
 * anonymous browse still serves an in-memory read model (TOV-189 unifies them); this table is the CAS
 * target for the fractionalize state machine (`verified → fractionalizing → fractionalized`).
 *
 * Also relaxes the `internal_audit_log` actor_type CHECK to admit `'admin'` (the fractionalize
 * `requested` audit carries the acting admin's `sub`).
 *
 * Seed (dev/test only — `CREATE TABLE` runs everywhere, INSERTs are guarded): a wallet-only artist
 * (`email`/`password_hash` NULL — satisfies the users email/hash CHECK, `CHK_users_password_needs_email`
 * post-migration …012, with no bcrypt) + a primary
 * byow wallet + the 3 browse fixtures, so the happy path is exercisable end-to-end. All INSERTs use
 * fixed UUIDs + `ON CONFLICT DO NOTHING` (idempotent re-run). Prod starts with an empty `artworks`.
 */
export class CreateArtworksTable1716000000027 implements MigrationInterface {
  name = 'CreateArtworksTable1716000000027';

  // Fixed seed identifiers (dev/test only).
  private static readonly SEED_ARTIST_ID = '00000000-0000-4000-8000-000000000a01';
  private static readonly SEED_WALLET_ID = '00000000-0000-4000-8000-000000000a02';
  private static readonly SEED_WALLET_PUBKEY = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  private static readonly SEED_ARTWORKS = [
    { id: '00000000-0000-4000-8000-0000000a0001', title: 'Northern Lights', year: 1998, medium: 'Oil on canvas', dim: '80x120 cm', name: 'Sophie Tove', handle: 'sophie-tove', img: 'https://cdn.tove.test/aw-001.jpg', status: 'verified' },
    { id: '00000000-0000-4000-8000-0000000a0002', title: 'Fjord Study', year: 2005, medium: 'Watercolor', dim: '30x40 cm', name: 'Ari Lund', handle: 'ari-lund', img: 'https://cdn.tove.test/aw-002.jpg', status: 'published' },
    { id: '00000000-0000-4000-8000-0000000a0003', title: 'Midnight Sun', year: 2012, medium: 'Acrylic', dim: '100x100 cm', name: 'Sophie Tove', handle: 'sophie-tove', img: 'https://cdn.tove.test/aw-003.jpg', status: 'verified' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "artworks" (
        "id"                uuid        NOT NULL DEFAULT gen_random_uuid(),
        "status"            varchar(16) NOT NULL DEFAULT 'verified',
        "artist_user_id"    uuid        NOT NULL,
        "title"             varchar(200) NOT NULL,
        "year"              int,
        "medium"            varchar(120),
        "dimensions"        varchar(120),
        "artist_name"       varchar(200),
        "artist_handle"     varchar(120),
        "primary_image_url" text,
        "created_at"        timestamptz NOT NULL DEFAULT now(),
        "updated_at"        timestamptz NOT NULL DEFAULT now(),
        "deleted_at"        timestamptz,
        CONSTRAINT "PK_artworks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_artworks_artist_user" FOREIGN KEY ("artist_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_artworks_status"
          CHECK ("status" IN ('verified','published','fractionalizing','fractionalized'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_artworks_status" ON "artworks" ("status") WHERE "deleted_at" IS NULL
    `);

    // Admit the 'admin' actor for fractionalize audit rows (append-only trigger unaffected). House
    // convention (…025/…026): bound the exclusive-lock acquisition and add the CHECK NOT VALID → VALIDATE
    // so the validating scan runs under SHARE UPDATE EXCLUSIVE, not ACCESS EXCLUSIVE. Widening only (adds
    // 'admin'), so every existing row already satisfies the predicate — VALIDATE cannot fail.
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(
      `ALTER TABLE "internal_audit_log" DROP CONSTRAINT IF EXISTS "CHK_internal_audit_log_actor_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "internal_audit_log" ADD CONSTRAINT "CHK_internal_audit_log_actor_type" ` +
        `CHECK ("actor_type" IN ('user', 'system', 'admin')) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "internal_audit_log" VALIDATE CONSTRAINT "CHK_internal_audit_log_actor_type"`,
    );

    // Seed by EXPLICIT opt-in only (`FRACTION_SEED_FIXTURES=true`), never in production even if the flag
    // is set. `NODE_ENV`-drift (Production/prod/unset) previously risked seeding fake, immediately-
    // fractionalizable fixtures into a mislabelled non-prod env; requiring an explicit flag closes that.
    if (process.env.NODE_ENV === 'production' || process.env.FRACTION_SEED_FIXTURES !== 'true') return;
    await queryRunner.query(
      `INSERT INTO "users" ("id", "email", "password_hash", "is_active") ` +
        `VALUES ($1, NULL, NULL, true) ON CONFLICT ("id") DO NOTHING`,
      [CreateArtworksTable1716000000027.SEED_ARTIST_ID],
    );
    await queryRunner.query(
      `INSERT INTO "wallets" ("id", "user_id", "public_key", "contract_address", "kind", "is_primary", "status") ` +
        `VALUES ($1, $2, $3, NULL, 'byow', true, 'active') ON CONFLICT ("id") DO NOTHING`,
      [
        CreateArtworksTable1716000000027.SEED_WALLET_ID,
        CreateArtworksTable1716000000027.SEED_ARTIST_ID,
        CreateArtworksTable1716000000027.SEED_WALLET_PUBKEY,
      ],
    );
    for (const a of CreateArtworksTable1716000000027.SEED_ARTWORKS) {
      await queryRunner.query(
        `INSERT INTO "artworks" ("id", "status", "artist_user_id", "title", "year", "medium", "dimensions", "artist_name", "artist_handle", "primary_image_url") ` +
          `VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT ("id") DO NOTHING`,
        [a.id, a.status, CreateArtworksTable1716000000027.SEED_ARTIST_ID, a.title, a.year, a.medium, a.dim, a.name, a.handle, a.img],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Refusing to revert CreateArtworksTable1716000000027 in production: "artworks" may back ' +
          'irreversible on-chain fraction_contracts. Roll back the deployment instead.',
      );
    }
    // Reverse the seed (child fraction_contracts is dropped by migration 028's down first).
    for (const a of CreateArtworksTable1716000000027.SEED_ARTWORKS) {
      await queryRunner.query(`DELETE FROM "artworks" WHERE "id" = $1`, [a.id]);
    }
    await queryRunner.query(`DELETE FROM "wallets" WHERE "id" = $1`, [
      CreateArtworksTable1716000000027.SEED_WALLET_ID,
    ]);
    await queryRunner.query(`DELETE FROM "users" WHERE "id" = $1`, [
      CreateArtworksTable1716000000027.SEED_ARTIST_ID,
    ]);
    // Re-narrow to ('user','system') as NOT VALID: `internal_audit_log` is append-only (…015/…017), so
    // any 'admin' rows written by this feature CANNOT be deleted to satisfy a validating re-add. NOT VALID
    // installs the constraint for future writes while tolerating the existing 'admin' rows.
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(
      `ALTER TABLE "internal_audit_log" DROP CONSTRAINT IF EXISTS "CHK_internal_audit_log_actor_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "internal_audit_log" ADD CONSTRAINT "CHK_internal_audit_log_actor_type" ` +
        `CHECK ("actor_type" IN ('user', 'system')) NOT VALID`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_artworks_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "artworks"`);
  }
}
