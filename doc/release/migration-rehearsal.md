# Migration upgrade rehearsal: `main` (5bc53a8) to release candidate (096d016)

> **This was a local simulation. It is not production evidence.**
> It ran on 26 Nov 2026 against a throwaway `postgis/postgis:15-3.4` container (PostgreSQL 15.8, the image in `docker-compose.yml`) on a sandbox machine. No remote database was touched and nothing was pushed or committed.
> The production schema, ledger, Postgres version, DB role and env values are **unknown**. Every conclusion below depends on the preconditions in §1, which must be checked read-only on production first.

- **Production code:** `origin/main` = `5bc53a8`, built in a separate worktree. Its app boots with `migrationsRun: true`.
- **Candidate:** `uiadedo/sleepy-bardeen-hxi0z4` HEAD = `096d016`. The branch later moved to `ea88c1c`, which only adds `doc/release/closeout-plan.md`, so the tested code is identical. Migrations run through `npm run migration:run -- --apply --expect <list>`, and the app boots with `migrationsRun: false` and `synchronize: false`.
- **Seed data:** three users with the `customer` role, all registered through main's real `/auth/register` endpoint and then activated by SQL. The rest went in by SQL: one item, one claim, one message room with a message, and one `found_item`.

## Results

| # | Check | Result | Evidence (local) |
|---|---|---|---|
| 1 | Local Postgres + PostGIS | **PASS** | `dockerd` started by hand, then `postgis/postgis:15-3.4` |
| 2a | Reproduce production schema from main's **migrations only** (`TYPEORM_SYNC=false`) | **FAIL (not a viable prod state)** | Ledger 001–026. There is no `google_id` column, because main never registers 027. There are no `role`/`user_role` tables. `/auth/register` returns 500, and the Postgres log shows `relation "user_role" does not exist`. Adding 027's DDL by hand with no ledger row does not help: `user_role` is still missing and register still fails. |
| 2b | Reproduce production schema with main booted using `TYPEORM_SYNC=true` (as in main's `.env.example`) | **PASS (assumed baseline)** | Ledger 001–026. Sync created `google_id`, `role` and `user_role`. Sync also **dropped** `idx_user_phone` and did **not** create `UQ_user_google_id`. Register, login and `/auth/me` work. |
| 3a | Bare `npm run migration:run` | Lists only (exit 0, DB not touched) | It prints the offline registry. Applying needs `--apply --expect`. |
| 3b | Apply with the closeout-plan list (027–036 (or 028–036), 8 names) | **FAIL-CLOSED (correct)** | `Pending migrations differ from the complete ordered --expect list; no migrations executed.` exit 1 |
| 3c | Apply with 027–035 (9 names) | **PASS** | All 9 applied, exit 0. CLI wall time 1.9 s. Seed data was intact afterwards. |
| 3d | Re-run (same list / empty list / no list) | **PASS (fail-closed, no change)** | Each exits 1 with a sanitized message. `pg_dump -s` and the ledger are byte-identical before and after. There is no "successful no-op" mode by design. |
| 3e | Concurrent release lock | **PASS** | While `pg_advisory_lock(16478005,1)` is held: `Another migration release owns the lock; no migrations executed.` |
| 3f | HEAD entities vs migrated schema | **PASS (cosmetic drift only)** | The TypeORM schema-builder dry run shows 14 queries, all FK/index/CHECK renames or re-creates and `images` default text. No missing tables or columns. |
| 4a | Runtime grants documented in repo | **FAIL (gap)** | No `GRANT` anywhere in migrations, README, `docs/`, `doc/` or `.env.example`. `migration-release.spec.ts` forbids `GRANT`/`CREATE POLICY` in 028. Only closeout-plan B2 mentions runtime grants. |
| 4b | Least-privilege role (`NOBYPASSRLS`, DML granted on all tables) on new tables | **FAIL** | RLS is enabled with **0 policies** on all 7 new tables. SELECT silently returns 0 rows, even with rows present. INSERT fails with `new row violates row-level security policy`. HEAD login as that role returns 503 (`auth_session`). |
| 4c | Same role with `BYPASSRLS` | **PASS** | HEAD login returns 200 and `/auth/me` returns 200. |
| 4d | Release gate: does HEAD refuse to boot with pending migrations? | **FAIL (no gate)** | HEAD booted on the unmigrated 2b DB. `/auth/health` returns 200, but login returns 503 (`relation "public.auth_session" does not exist`). The gate exists only in the CLI. |
| 5a | Rollback pair: main code + migrated schema, `TYPEORM_SYNC=false` | **PASS (degraded)** | Main boots and the schema is unchanged. Login, register, `/auth/me`, `/items/me/listed`, `/found-items`, `/found-items/my-posts`, rooms and room messages return 200. `/found-items?postcode=E1` returned 500 because the sandbox has no network access for the geocoder; this is not a schema problem. Attachment messages show as empty (text and imageUrl are null). HEAD-issued tokens are accepted by main. |
| 5b | Rollback pair: main code + migrated schema, `TYPEORM_SYNC=true` | **FAIL (destructive)** | With a `gone` found item present, main crash-loops: sync's enum recast fails and is rolled back, so the app never listens. **Without** a `gone` row, main boots and sync **drops** `message."hasAttachment"`, `found_item.last_seen_at/closed_at/expiry_nudged_at`, `UQ_user_google_id`, `found_item_lifecycle_due_idx` and the `gone` enum value. The ledger still says 035, so a later HEAD redeploy breaks. |
| 5c | `down()` reversibility of 027–036 (or 028–036) | **Irreversible by design** | Every `down()` from 028 to 035 throws. Only 027 has a real `down()`. Rollback means code only. |
| 6a | Main-issued **access** token on HEAD `JwtAuthGuard` | **FAIL: users logged out** | `/auth/me`, `/items/me/listed` and `/found-items/my-posts` return 401 `Invalid or expired session`. |
| 6b | Main-issued **refresh** token on HEAD `/auth/refresh` | **FAIL: users logged out** | 401 `Invalid or expired session` |
| 6c | HEAD login after migration | **PASS** | Creates an `auth_session` row. Tokens carry `sid` and `type`. `/auth/me` returns 200. |
| 6d | HEAD boot with a weak `JWT_SECRET` (`change-me`) | **Refuses to boot** (intended) | `JWT_SECRET must be explicitly configured with at least 32 bytes`, exit 1 |

## 1. Preconditions to verify on production (read-only) before B2

The rehearsal could not determine which baseline production is on. Run these with a read-only role. Run the role query on the app's own runtime connection, or replace `current_user` with the runtime role's name:

```sql
SELECT id, "timestamp", name FROM public.migrations ORDER BY "timestamp" DESC LIMIT 5;  -- 026 or 027 on top?
SELECT column_name FROM information_schema.columns WHERE table_name='user' AND column_name='google_id';
SELECT indexname FROM pg_indexes WHERE tablename='user';  -- UQ_user_google_id? idx_user_phone?
SELECT google_id, count(*) FROM "user" WHERE google_id IS NOT NULL GROUP BY 1 HAVING count(*)>1;  -- must be empty or 027 fails
SHOW server_version;  -- 033 fast default needs >=11; 028 ADD VALUE in a txn needs >=12
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user;  -- on the runtime connection
SELECT tableowner FROM pg_tables WHERE tablename IN ('user','message','found_item');
```

Also record the production **`TYPEORM_SYNC`** value and **`JWT_SECRET` byte length**. Do not record the secret value.

How the result changes the release:

- **Ledger top is 026** (expected from main's code): the `--expect` list is **027–035, nine names**. Closeout-plan B2's "0028–0035" is wrong for this case, and the CLI will refuse it. If 027's DDL was already applied by hand without a ledger row, 027 is still pending. It is `IF NOT EXISTS`, so it is a harmless no-op.
- **Ledger top is 027**: the list is 027–036 (or 028–036). This branch was **not** rehearsed.

Verified `--expect` value for the 026 case:
```
AddGoogleAuthToUser1700000000027,FoundItemLifecycle1700000000028,CreateAuthSessions1700000000029,CreateAuthRateCounters1700000000030,CreateAuthResetEmailCounters1700000000031,CreateMessageReadReceipts1700000000032,CreatePrivateMessageAttachments1700000000033,AllowRefreshRateCounter1700000000034,CreateAuthEmailOutbox1700000000035
```

## 2. Applied migrations and timings (local, tiny dataset)

Each migration ran in its own transaction (`transaction = 'each'`). Timings come from Postgres `log_statement=all` logs, START TRANSACTION to COMMIT:

| Migration | ms | Ledger id |
|---|---|---|
| AddGoogleAuthToUser1700000000027 | 8 | 27 |
| FoundItemLifecycle1700000000028 | 13 | 28 |
| CreateAuthSessions1700000000029 | 7 | 29 |
| CreateAuthRateCounters1700000000030 | 4 | 30 |
| CreateAuthResetEmailCounters1700000000031 | 5 | 31 |
| CreateMessageReadReceipts1700000000032 | 5 | 32 |
| CreatePrivateMessageAttachments1700000000033 | 8 | 33 |
| AllowRefreshRateCounter1700000000034 | 2 | 34 |
| CreateAuthEmailOutbox1700000000035 | 10 | 35 |

There were no errors. These timings say nothing about production table sizes or lock contention.

## 3. Migration review (027–035)

| Migration | Locking / cost on existing tables | NOT NULL without default | Backfill | `down()` |
|---|---|---|---|---|
| 027 | `CREATE UNIQUE INDEX` (not `CONCURRENTLY`) on `"user"`: SHARE lock blocks user writes, including login and register, while it builds. It fails if duplicate `google_id` values exist. | no | none | real (drops index and column) |
| 028 | `ALTER TYPE ... ADD VALUE` (PG ≥12 inside a txn). Three nullable `ADD COLUMN` on `found_item` (ACCESS EXCLUSIVE, brief, no rewrite). Non-concurrent partial `CREATE INDEX` on `found_item` (SHARE lock, full scan; index starts empty). New table with FKs to `found_item` and `"user"`. | no | **none, deliberate**: historical rows keep `last_seen_at` NULL and stay unscheduled | throws |
| 029–032, 035 | New tables only. FK creation briefly takes SHARE ROW EXCLUSIVE on `"user"` / `message`. | n/a (new tables) | none | throws |
| 033 | `ALTER TABLE message ADD COLUMN "hasAttachment" boolean NOT NULL DEFAULT false`. On PG ≥11 this is a metadata-only fast default, but it takes a brief ACCESS EXCLUSIVE lock on `message`. | has default, safe | none | throws |
| 034 | Drops and re-adds a CHECK on `auth_rate_counter`, a new and tiny table | n/a | none | throws |

Notes:

- The release CLI sets no `lock_timeout` or `statement_timeout`. A long-running transaction on `"user"` or `message` would make 027 or 033 queue behind it, and every app query would then queue behind the migration. Recommendation: run in a low-traffic window, and have the operator set `lock_timeout` (for example `PGOPTIONS='-c lock_timeout=5s'`).
- A partial failure leaves the ledger at a clean prefix, because each migration has its own transaction. Re-run with the remaining names as `--expect`.
- The CLI refuses an empty or missing ledger ("separate bootstrap"). Neither main's nor HEAD's migrations can build a working schema from empty, because `role`/`user_role` come only from sync. This matters for disaster recovery: restore from backup, not from migrations.

## 4. Runtime role and grants

What the repo says:

- No migration or document contains a `GRANT`. `migration-release.spec.ts` asserts that 028 contains no `GRANT` or `CREATE POLICY`. 029–035 contain none either.
- The migrations `REVOKE ALL ... FROM PUBLIC` (and from `anon`, `authenticated`, and in 031, 032, 033 and 035 `service_role` where those roles exist) and `ENABLE ROW LEVEL SECURITY` with **no policies** and without `FORCE`.
- The new tables are therefore usable **only** by the table owner (the migrating role) or a role with `BYPASSRLS`.
- On a Supabase-style setup, `service_role` is explicitly revoked on the tables from 031, 032, 033 and 035.

Verbs HEAD's code uses on each table:

| Table | Verbs needed (from code) |
|---|---|
| `auth_session` | SELECT, INSERT, UPDATE (`repo.save`, `update`, `pessimistic_write`) |
| `auth_rate_counter` | SELECT, INSERT, UPDATE (`ON CONFLICT DO UPDATE ... RETURNING`) |
| `auth_reset_email_counter` | SELECT, INSERT, UPDATE, DELETE (`FOR UPDATE SKIP LOCKED`, cleanup) |
| `auth_email_outbox` | SELECT, INSERT, UPDATE, DELETE (`FOR UPDATE SKIP LOCKED`) |
| `message_read_receipt` | SELECT, INSERT (`ON CONFLICT DO NOTHING`) |
| `message_attachment` | SELECT, INSERT |
| `found_item_observation` | SELECT, INSERT, UPDATE (`upsert`) |

**Grants alone are not enough (4b).** A least-privilege runtime role needs one of these:

- (a) Run as the table owner, which is what 2b/3c did. Owners bypass non-forced RLS.
- (b) `ALTER ROLE <runtime> BYPASSRLS`. This needs superuser.
- (c) Reviewed permissive policies `TO <runtime>` on each table. These must be applied outside migrations 027–036 (or 028–036), because the reviewed migrations deliberately contain none and the spec forbids them in 028.

The runtime role also needs `UPDATE` on `"user"`, because the outbox uses `FOR UPDATE OF account`.

**Release gate:** `migration-release.ts` gates only the CLI. It requires an explicit list, the ledger must be a complete prefix, `search_path` must be public, and it takes an advisory lock. **Nothing stops the app from booting with pending migrations** (4d). The closeout plan's order of **B1 (deploy) then B2 (migrate)** therefore means every login fails (503) between deploy and migration.

## 5. Rollback feasibility (old code + new schema)

- The migrations are additive for main's queries. Main with `TYPEORM_SYNC=false` ran normally on the migrated schema. Rows created by main get `hasAttachment=false` from the default, and attachment messages show as empty.
- **Main with `TYPEORM_SYNC=true` is not a safe rollback (5b).** It either crash-loops on `gone` rows or silently drops the new columns, index and enum value, which loses data and puts the schema out of step with the ledger. **Before B2, confirm production `TYPEORM_SYNC` is `false`.** If it is `true`, set it to `false` on main first and verify main still runs.
- Tokens across rollback (tested): a HEAD-issued access token was accepted by main's `/auth/me` (200), because main ignores `sid`.
- Tokens across rollback (inferred from code, not tested): sessions revoked on HEAD (logout or reset) are **not** honoured by main until each token's own expiry. That expiry is HEAD's access TTL (15m in this run); main's 60d TTL applies only to tokens main issues. Tokens issued by main during a rollback window would again be rejected after rolling forward (see §6).

## 6. Will signed-in production users be logged out on deploy?

**Yes. Every existing session ends on deploy.** Both the guard code and the live test show this.

What the code says:

- HEAD's `verifyAccessToken` calls `AuthSessionsService.assertActive`. That check requires a UUID `sid` claim and a matching non-revoked `auth_session` row.
- Main's tokens have no `sid`: the access token carries `{sub, email, roles, iat, exp}` and the refresh token `{sub, email, type:'refresh', iat, exp}`. There is no legacy fallback.

What the test shows:

- Main-minted tokens came from main's real `/auth/login` with the same 60-byte secret on both apps.
- On HEAD, the access token gets 401 on `/auth/me`, `/items/me/listed` and `/found-items/my-posts`.
- The refresh token gets 401 on `/auth/refresh`.
- Users must sign in again. The frontend `83d30d6` should handle a 401 on refresh by sending users to the login page; that was not verified here.

**Additional risk:** if production's `JWT_SECRET` is shorter than 32 bytes or is `change-me`, HEAD **will not boot**. Rotating the secret costs nothing extra, because sessions are lost anyway.

## Recommended corrections to the closeout plan

1. **Order:** migrate first (B2), then deploy (B1). Main runs on the migrated schema (5a), but HEAD does not run on the old one (4d).
2. **B2 `--expect` list:** use 027–035 (nine names), unless the production ledger already holds 027.
3. **Before B2:** confirm `TYPEORM_SYNC=false` in production. Check for duplicate `google_id` values, the PG version (≥12) and the runtime role's owner/`BYPASSRLS` status.
4. **B2 "grant runtime privileges":** state the mechanism (owner, `BYPASSRLS` or policies). GRANTs alone leave the role reading empty tables and failing inserts.
5. **Announce a forced re-login.**

## How to reproduce

All scripts and logs are in the session scratchpad and are not committed. The steps were:

1. Worktree of `origin/main`, then `npm ci && npm run build`.
2. Boot main with env from `.env.example`, `DB_PASS=pg`, a 60-byte `JWT_SECRET` and `TYPEORM_SYNC=true` on an empty DB.
3. Register and log in through the API, then add seed rows by SQL.
4. In the candidate checkout, `npm run build`, then `npm run migration:run -- --apply --expect <9 names>` with env passed inline. No `.env` was written to the repo.
5. Clone databases with `CREATE DATABASE ... TEMPLATE` for the rollback and RLS variants.
