import { DataSource } from 'typeorm';
import { ThrottlerStorage } from '@nestjs/throttler';

/**
 * No-op ThrottlerStorage for e2e tests: reports zero hits so per-route
 * `@Throttle` limits (e.g. register 3/min, login 5/min) never trip during a
 * suite run. Use with `.overrideProvider(ThrottlerStorage).useValue(...)`.
 */
export const noOpThrottlerStorage: ThrottlerStorage = {
  increment: () =>
    Promise.resolve({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

export async function truncateTables(dataSource: DataSource): Promise<void> {
  // Safety guard: this runs TRUNCATE ... CASCADE over every table, so refuse to
  // fire against anything that is not clearly a test database. Prevents an
  // exported DB_DATABASE / DB_HOST from wiping a dev/prod database.
  const database = String(dataSource.options.database ?? '');
  if (!/test/i.test(database)) {
    throw new Error(
      `Refusing to TRUNCATE: database "${database}" does not look like a test database ` +
        `(its name must contain "test"). Check your DB_DATABASE / test env configuration.`,
    );
  }

  const entities = dataSource.entityMetadatas;
  for (const entity of entities) {
    const repository = dataSource.getRepository(entity.name);
    await repository.query(`TRUNCATE TABLE "${entity.tableName}" CASCADE`);
  }
}
