# Local checks and test safety

Use the repository's pinned Node version and install the lockfile with:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Typechecking, linting without `--fix`, and compilation do not start the API. Build removes and recreates `dist`. Dependency lifecycle scripts are intentionally skipped.

## Isolated unit tests

`test:unit` launches `scripts/check-unit-tests.cjs`, which passes only explicitly reviewed test paths to a separate Jest configuration. `node scripts/check-unit-tests.cjs --listTests` lists the selected files without running them. The existing `jest.config.ts` remains unchanged.

The reviewed suites mock database repositories, email, JWT verification and Google token verification. The items privacy suites test claim visibility and neutral public donor labels using synthetic data, including restricted donor projections, retained verification/location/search filters and owner-authorized collector records. The found-item identity suite tests neutral labels in item/claim responses, interest notifications and rescue/flytip broadcasts, with real-name and email-fallback sentinels. It also checks owner/claimant/unrelated-viewer visibility and retained private records using mocked repositories, geocoding, notifications, gateway and gamification. The migration-release suite exercises pure planning and mocked sessions, and checks registry completeness through source ASTs without importing AppModule or actual migration modules. Additions require reviewing their imports and side effects, then updating the launcher's allowlist; adding another `src/**/*.spec.ts` file does not automatically execute it.

The child test process receives a small operating-system environment allowlist and synthetic test settings, rather than inherited database credentials, email keys, `NODE_OPTIONS` or dotenv configuration. The unit configuration does not load dotenv. TypeORM's passive dotenv import is replaced with a mock that throws if asked to load or parse configuration. Its resolver rejects imports of application startup, migrations and `dotenv/config`. Per-suite setup blocks fetch, HTTP requests, socket connections/listeners, UDP and child processes. Failures must be handled with mocks rather than disabling the guards.

These are safeguards against accidental integration use, not a security sandbox for hostile test code. Test code can read local files and intentionally undo JavaScript patches. Run reviewed code only, without production secrets mounted; use operating-system network isolation for stronger assurance. The parent Node process still starts before the launcher sanitises the child environment, so launch it from a clean shell without inherited `NODE_OPTIONS` preloads.

The gamification identity suite tests neutral community-board and individual-leaderboard labels with named, email-only and missing user relations, including current users outside the displayed page. It verifies totals, filters and deterministic tied account-ID ordering. Its fixture replaces the existing leaderboard backfill/sync method with a no-op: this tests projections without executing the pre-existing write-on-read behaviour. It does not validate points backfill or award calculations.

The messages identity suite uses synthetic room participants and mocked repositories, presence, media and gateway. It verifies neutral identity projections in room summaries, history, search and send responses, plus captured per-participant realtime payloads. Named and email-only account fixtures retain their private fields internally; responses use the compatibility label `firstName: 'Community member', lastName: null`. Existing clients concatenate these fields. Room access denials and null system senders remain covered. Capturing a mocked gateway is not a live socket delivery test, and mocked image uploads do not contact Cloudinary.

The outward-postcode suite recognises the six standard postcode shapes, compact/spaced values, outward-only codes and malformed inputs without any lookup provider. Board/leaderboard tests verify the shared parser at response boundaries. It checks format and output minimisation, not whether a postcode is allocated or a location is anonymous. Full postcode storage normalisation is unchanged.

The geocoding suite replaces global fetch with mocked Nominatim-shaped responses, uses fake timers and never calls a provider. It checks strict coordinate bounds/types, genuine-empty fallback ordering and deduplication, HTTP/protocol errors, one bounded fetch/body/fallback deadline, cancellation and ignored late responses. Reverse results preserve requested GPS and leave absent address fields null. The public-location and found-item location suites verify coarse point/postcode projections and owner/viewer boundaries with mocked repositories; they do not prove PostGIS parity or deployed spatial-search behaviour.

## Commands outside this baseline

Do not use `npm test` as an equivalent: its original config loads dotenv and discovers legacy E2E suites. Those current E2E suites use mocks, but some have stale imports and they are outside the reviewed unit selection.

Runtime and release connection options now hardcode `migrationsRun:false`, `synchronize:false`, `dropSchema:false` and `installExtensions:false`. `TYPEORM_SYNC` can no longer enable automatic DDL. With `ENABLE_DB=true`, app startup still connects to the configured database; it is not an isolated unit test. Existing extensions and schema are prerequisites.

Bare `migration:run` and `--list` print the offline registry only, without loading dotenv or constructing a DataSource. They do not show live pending status. Execution requires both `--apply` and an explicit complete ordered `--expect` list, followed by a locked SELECT-only ledger preflight. A missing/empty ledger or history drift aborts; new databases need a separately reviewed bootstrap procedure. TypeORM `showMigrations()` is deliberately unused because it can create the ledger table. Migration execution remains a separately approved release operation, not a normal check.

Production and staging separation must be verified before integration tests or migrations. App startup, database tests, email delivery, uploads and other real integrations require a separate approved isolated environment and are not exercised by this workflow.

This workflow supplies check results; branch protections and deployment gates must be configured separately. It does not change existing Railway auto-deployment behaviour.
