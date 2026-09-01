---
status: complete
priority: p2
issue_id: "060"
tags: [code-review, data-integrity, migration]
dependencies: []
---

# Migration down() Does Not Re-create IDX_users_role_active Index

## Problem Statement

The original `CreateUsersTable` migration (1716000000000) creates a composite index `IDX_users_role_active` on `(role, is_active) WHERE deleted_at IS NULL`. PostgreSQL automatically drops this index when the `role` column is dropped. However, the `down()` migration in `1716000000008-DropUserRoleColumn.ts` only re-creates the column and CHECK constraint — it does not re-create the index. A rollback would produce a degraded schema.

## Findings

- `src/database/migrations/1716000000000-CreateUsersTable.ts` lines 42-46 create `IDX_users_role_active`
- `src/database/migrations/1716000000008-DropUserRoleColumn.ts` `down()` omits the index
- PostgreSQL auto-drops dependent indexes on `DROP COLUMN` (no error), but rollback must restore them
- Identified by: data-integrity-guardian (Finding 1)

## Proposed Solutions

### Option 1: Add index re-creation to down() (Recommended)

**Approach:** Add the missing `CREATE INDEX` to the `down()` method:

```typescript
public async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'user'`);
  await queryRunner.query(
    `ALTER TABLE users ADD CONSTRAINT "CHK_users_role" CHECK (role IN ('user', 'admin'))`,
  );
  await queryRunner.query(`
    CREATE INDEX "IDX_users_role_active"
      ON "users" ("role", "is_active")
      WHERE "deleted_at" IS NULL
  `);
}
```

- **Effort:** Small
- **Risk:** None

## Technical Details

- **Affected files:** `src/database/migrations/1716000000008-DropUserRoleColumn.ts`

## Acceptance Criteria

- [ ] `down()` method re-creates `IDX_users_role_active` index
- [ ] `yarn migration:run` and `yarn migration:revert` both succeed
