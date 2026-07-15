#!/usr/bin/env bash
#
# Provision the local test database used by the integration and e2e suites.
#
# Both suites run against a local Postgres database (default: tove_test) whose
# schema is loaded here, out-of-band, because TypeORM cannot load the .ts
# migrations at runtime under vitest/SWC (so the suites use migrationsRun:false).
#
# Idempotent: safe to run repeatedly. Already-applied migrations are skipped.
#
# Override any of these via env vars:
#   DB_HOST (localhost)  DB_PORT (5432)  DB_USERNAME (tove)
#   DB_PASSWORD (tove_secret -- local test-only credential)  DB_DATABASE (tove_test)
# Admin connection (used only to create the role/db):
#   PGADMIN_DB (postgres)  PGADMIN_USER (current OS user)
# Safety override:
#   ALLOW_NONTEST_DB=1  -- permit a DB_DATABASE whose name does not contain "test"
#
set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USERNAME="${DB_USERNAME:-tove}"
DB_PASSWORD="${DB_PASSWORD:-tove_secret}"
DB_DATABASE="${DB_DATABASE:-tove_test}"

# Validate identifiers before they reach SQL. Role/database names are quoted as
# psql identifiers below, but reject anything unusual up front so a malformed
# value can never be interpreted as SQL.
valid_ident() { [[ "$1" =~ ^[A-Za-z0-9_]+$ ]]; }
for pair in "DB_USERNAME=$DB_USERNAME" "DB_DATABASE=$DB_DATABASE"; do
  name="${pair%%=*}"; value="${pair#*=}"
  if ! valid_ident "$value"; then
    echo "ERROR: $name='$value' is not a valid identifier (only [A-Za-z0-9_])." >&2
    exit 1
  fi
done

# Guard: refuse to touch anything that is not clearly a test database (unless
# explicitly overridden). Prevents "provision the test DB" from migrating a
# dev/prod database when DB_DATABASE is exported.
if [[ "$DB_DATABASE" != *test* && "${ALLOW_NONTEST_DB:-}" != "1" ]]; then
  echo "ERROR: refusing to provision non-test database '$DB_DATABASE'." >&2
  echo "       Its name must contain 'test'. Set ALLOW_NONTEST_DB=1 to override." >&2
  exit 1
fi

ADMIN_DB="${PGADMIN_DB:-postgres}"
PSQL_ADMIN=(psql -h "$DB_HOST" -p "$DB_PORT" -d "$ADMIN_DB" -v ON_ERROR_STOP=1)
[ -n "${PGADMIN_USER:-}" ] && PSQL_ADMIN+=(-U "$PGADMIN_USER")

# SQL is piped via stdin (quoted heredoc, no shell expansion) so psql performs
# variable interpolation: :'var' -> quoted string literal, :"var" -> quoted
# identifier. Injection-safe regardless of the value (psql -c does NOT
# interpolate, hence stdin).
echo "==> Ensuring role '$DB_USERNAME' exists"
role_exists="$(
  "${PSQL_ADMIN[@]}" -tA -v role="$DB_USERNAME" <<'SQL'
SELECT 1 FROM pg_roles WHERE rolname = :'role';
SQL
)"
if [ "$role_exists" != "1" ]; then
  "${PSQL_ADMIN[@]}" -v role="$DB_USERNAME" -v pass="$DB_PASSWORD" <<'SQL'
CREATE ROLE :"role" WITH LOGIN PASSWORD :'pass' CREATEDB;
SQL
fi

echo "==> Ensuring database '$DB_DATABASE' exists"
db_exists="$(
  "${PSQL_ADMIN[@]}" -tA -v db="$DB_DATABASE" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'db';
SQL
)"
if [ "$db_exists" != "1" ]; then
  "${PSQL_ADMIN[@]}" -v db="$DB_DATABASE" -v owner="$DB_USERNAME" <<'SQL'
CREATE DATABASE :"db" OWNER :"owner";
SQL
fi

echo "==> Running migrations on '$DB_DATABASE'"
# -t each: run each migration in its own transaction so migrations that opt out
# of the global transaction can apply.
DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USERNAME="$DB_USERNAME" \
DB_PASSWORD="$DB_PASSWORD" DB_DATABASE="$DB_DATABASE" \
  yarn typeorm migration:run -t each

echo "==> Test database ready: $DB_USERNAME@$DB_HOST:$DB_PORT/$DB_DATABASE"
