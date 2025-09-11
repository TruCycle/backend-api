# TruCycle Backend API

NestJS + TypeORM (Postgres/PostGIS) + Swagger skeleton for TruCycle.

## Quick Start

1) Prereqs
- Node.js 18+
- One of:
  - Docker Desktop (recommended path), or
  - Local/hosted Postgres with PostGIS (no‑Docker path)

2) Configure env
- Copy `.env.example` to `.env`.
- Ensure `ENABLE_DB=true` when you have a database available (local or hosted).

### Option A: With Docker (Postgres + PostGIS)

3) Start database
```
docker compose up -d
```

4) Install deps
```
npm install
```

5) Run migrations (creates PostGIS extension)
```
npm run migration:run
```

6) Start API
```
npm run start:dev
```
- Swagger UI: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/openapi.json

### Option B: Without Docker (local or hosted Postgres)

3) Install Postgres + PostGIS
- Windows: Install PostgreSQL (EDB installer) and add PostGIS via Stack Builder.
- macOS: `brew install postgresql@15 postgis` (or use Postgres.app with PostGIS).
- Ubuntu/Debian: `sudo apt install postgresql-15 postgresql-15-postgis-3`

4) Create database and (optionally) a user
```
# Example using default superuser `postgres`
psql -U postgres -h localhost -c "CREATE DATABASE trucycle;"
# (Optional) create a dedicated user and grant access
psql -U postgres -h localhost -c "CREATE USER trucycle_user WITH PASSWORD 'strongpassword';"
psql -U postgres -h localhost -d trucycle -c "GRANT ALL PRIVILEGES ON DATABASE trucycle TO trucycle_user;"
```
- Note: The migration will run `CREATE EXTENSION IF NOT EXISTS postgis`, but the PostGIS extension must be installed in the cluster (step 3) for this to work.

5) Configure `.env`
- Set `ENABLE_DB=true`.
- Point `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` to your instance.
- For hosted providers (e.g., Supabase/Neon), set `DB_SSL=true`.

6) Install deps and run migrations
```
npm install
npm run migration:run
```

7) Start API
```
npm run start:dev
```
- Swagger UI: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/openapi.json

### Notes on hosted Postgres
- Supabase includes PostGIS; after creating a project, ensure `CREATE EXTENSION postgis;` (the migration also attempts this).
- Some providers require SSL; `DB_SSL=true` is usually sufficient (they use trusted certs).

## Notes
- All geometry columns use SRID 4326 (per architecture doc).
- Mutating routes will adopt Idempotency-Key in future iterations.
- Modules created: auth, users, items, claims, shops, qr, search, notifications, admin.

## API Response & Error Handling
- Success envelope: `{ status: 'success', message: 'OK', data: <payload> }` (applied by a global interceptor).
- Error envelope: `{ status: 'error', message: <reason>, data: null }` (applied by a global exception filter).
- Throw `HttpException` (e.g., `BadRequestException`, `UnauthorizedException`) from handlers; the global filter formats output.

## Auth (JWT)
- Endpoints:
  - `POST /auth/register` { email, password, role? } → returns `{ user, token }`.
  - `POST /auth/login` { email, password } → returns `{ user, token }`.
- Roles: `customer`, `collector`, `facility`, `admin`, `finance`, `partner`.
- Env vars: `JWT_SECRET`, `JWT_EXPIRES_IN` (see `.env.example`).
