# Tove Backend

Backend API for the Tove platform — fractionalized art tokenization (RWA).

## Tech Stack

- **Framework:** NestJS 11 with TypeScript (strict mode) and SWC compiler
- **Database:** PostgreSQL 16 via TypeORM
- **Cache/Queue:** Redis 7 with BullMQ
- **Auth:** JWT (access + refresh tokens), HMAC-SHA256 refresh token hashing, RBAC
- **Testing:** Vitest (unit, integration, e2e)
- **Containerization:** Docker with multi-stage builds

## Prerequisites

- Node.js 20+
- Yarn
- PostgreSQL 16
- Redis 7

## Getting Started

```bash
# Install dependencies
yarn install

# Copy environment variables
cp .env.example .env

# Start PostgreSQL and Redis
docker compose -f docker-compose.dev.yml up -d

# Run database migrations
yarn migration:run

# Start development server
yarn start:dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `yarn build` | Build for production |
| `yarn start:dev` | Start with hot reload |
| `yarn start:prod` | Run production build |
| `yarn lint` | Lint and auto-fix |
| `yarn test` | Run unit tests |
| `yarn test:integration` | Run integration tests (requires DB) |
| `yarn test:e2e` | Run e2e tests (requires DB + Redis) |
| `yarn test:all` | Run all test suites |
| `yarn migration:run` | Run pending migrations |
| `yarn migration:revert` | Revert last migration |

## Docker

```bash
# Full stack (app + PostgreSQL + Redis)
docker compose up

# Services only (PostgreSQL + Redis)
docker compose -f docker-compose.dev.yml up -d
```

## API Documentation

- **Development:** Swagger UI at `http://localhost:3000/docs`
- **All environments:** OpenAPI JSON spec at `/api/v1/docs/json`

## Project Structure

```
src/
  common/        # Shared guards, filters, decorators, base classes, enums
  config/        # Typed configuration (registerAs pattern)
  database/      # TypeORM module, data source, migrations
  modules/
    auth/        # JWT authentication and authorization
    users/       # User management with repository pattern
    health/      # Health check endpoint
    jobs/        # BullMQ background job processing
```

## License

UNLICENSED
