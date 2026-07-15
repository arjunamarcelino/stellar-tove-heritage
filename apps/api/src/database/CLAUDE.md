# Database

PostgreSQL 16 via TypeORM. `synchronize: false` -- all schema changes via migrations.

## Migrations

Located in `src/database/migrations/`. Naming: `{timestamp}-{Description}.ts`.

```bash
yarn migration:run      # Run pending migrations
yarn migration:revert   # Revert last migration
yarn migration:generate # Auto-generate from entity changes (use cautiously)
```

Write migrations by hand. The auto-generate command can miss partial indexes and other PostgreSQL-specific features.

## Rules

- Every table with soft deletes (`deleted_at`) must have partial indexes: `WHERE "deleted_at" IS NULL`
- Connection pool: max 20, min 5, connectionTimeoutMillis 5000, idleTimeoutMillis 30000
- Shared defaults live in `src/config/database.defaults.ts` -- used by both runtime config and CLI data-source
- `data-source.ts` is the CLI data-source for TypeORM migrations (imports same defaults)
- `database.module.ts` is the NestJS module (uses `registerAs` config injection)

## Adding a New Migration

1. Create file in `src/database/migrations/` with next timestamp
2. Implement `up()` and `down()` methods
3. Include partial indexes for any soft-delete-filtered columns
4. Test both `up` and `down` paths
