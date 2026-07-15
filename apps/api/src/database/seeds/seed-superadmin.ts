import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { DB_DEFAULTS } from '@config/database.defaults';

dotenv.config();

async function seedSuperadmin(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email) {
    console.error('SUPERADMIN_EMAIL env var is required');
    process.exit(1);
  }

  if (!password || password.length < 12) {
    console.error('SUPERADMIN_PASSWORD env var is required and must be at least 12 characters');
    process.exit(1);
  }

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? DB_DEFAULTS.host,
    port: parseInt(process.env.DB_PORT ?? String(DB_DEFAULTS.port), 10),
    username: process.env.DB_USERNAME ?? DB_DEFAULTS.username,
    password: process.env.DB_PASSWORD ?? DB_DEFAULTS.password,
    database: process.env.DB_DATABASE ?? DB_DEFAULTS.database,
  });

  await dataSource.initialize();

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result: [unknown[], number] = await dataSource.query(
      `INSERT INTO "admins" ("id", "email", "password_hash", "role", "is_active", "created_at", "updated_at")
       VALUES (gen_random_uuid(), $1, $2, 'superadmin', true, now(), now())
       ON CONFLICT ("email") WHERE "deleted_at" IS NULL
       DO UPDATE SET "password_hash" = $2, "updated_at" = now()`,
      [email.toLowerCase().trim(), passwordHash],
    );

    if (result[1] === 0) {
      console.log('No changes made.');
    } else {
      console.log('Superadmin seeded (created or password updated).');
    }
  } finally {
    await dataSource.destroy();
  }
}

seedSuperadmin().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
