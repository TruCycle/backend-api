import type { Logger } from 'typeorm';

export class MigrationSafetyError extends Error {}

// TypeORM migration errors can log raw database details even with logging:false.
// Release output is limited to the CLI's reviewed names and sanitized errors.
export function createMigrationReleaseLogger(): Logger {
  return {
    logQuery() {}, logQueryError() {}, logQuerySlow() {},
    logSchemaBuild() {}, logMigration() {}, log() {},
  };
}

export interface MigrationReleaseSession {
  query: (sql: string, parameters?: unknown[]) => Promise<unknown>;
  executePending: () => Promise<string[]>;
  close: () => Promise<void>;
}

type MigrationCommand = { kind: 'list' } | { kind: 'apply'; expected: string[] };
const RELEASE_LOCK = [16478005, 1];

export function parseMigrationCommand(args: readonly string[], registered: readonly string[]): MigrationCommand {
  if (args.length === 0 || (args.length === 1 && args[0] === '--list')) return { kind: 'list' };
  let apply = false;
  let expected: string[] | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply' && !apply) apply = true;
    else if (argument === '--expect' && expected === undefined) {
      const names = args[++index];
      if (!names || names.startsWith('--')) throw new MigrationSafetyError('--expect needs an explicit comma-separated migration-name list.');
      expected = names.split(',').map((name) => name.trim());
    } else throw new MigrationSafetyError('Unknown or repeated migration option. Use --list or --apply --expect <complete ordered names>.');
  }
  if (!apply || !expected?.length || expected.some((name) => !name)) {
    throw new MigrationSafetyError('Applying migrations requires both --apply and an explicit non-empty --expect list.');
  }
  if (new Set(expected).size !== expected.length || expected.some((name) => !registered.includes(name))) {
    throw new MigrationSafetyError('--expect contains duplicate or unregistered migration names.');
  }
  return { kind: 'apply', expected };
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'object' || entry === null)) {
    throw new MigrationSafetyError('Unexpected migration preflight result.');
  }
  return value as Record<string, unknown>[];
}

export function pendingMigrationNames(registered: readonly string[], ledger: unknown): string[] {
  const timestamps = registered.map((name) => name.match(/\d{13}$/)?.[0]);
  if (new Set(registered).size !== registered.length || timestamps.some((stamp, index) => !stamp || (index > 0 && stamp <= timestamps[index - 1]!))) {
    throw new MigrationSafetyError('Migration registry must have unique names and ascending unique timestamps.');
  }
  const executed = rows(ledger);
  if (!executed.length) throw new MigrationSafetyError('Empty migration ledger: a separately reviewed database bootstrap is required.');
  const names = new Set<string>();
  for (const entry of executed) {
    const name = typeof entry.name === 'string' ? entry.name : '';
    const index = registered.indexOf(name);
    if (index < 0 || names.has(name)) throw new MigrationSafetyError('Unknown or duplicate migration ledger entry; reconcile history before release.');
    if (String(entry.timestamp) !== timestamps[index]) throw new MigrationSafetyError('Migration ledger name/timestamp mismatch; reconcile history before release.');
    names.add(name);
  }
  // Missing early entries followed by later ones indicate history drift, not a release plan.
  if (registered.slice(0, executed.length).some((name) => !names.has(name))) {
    throw new MigrationSafetyError('Migration ledger is not a complete prefix of the registered history.');
  }
  return registered.slice(executed.length);
}

export async function runMigrationCommand(
  args: readonly string[],
  registered: readonly string[],
  createSession: () => Promise<MigrationReleaseSession>,
): Promise<{ kind: 'list' | 'applied'; names: readonly string[] }> {
  const command = parseMigrationCommand(args, registered);
  if (command.kind === 'list') return { kind: 'list', names: registered };
  const session = await createSession();
  let locked = false;
  try {
    const lock = rows(await session.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', RELEASE_LOCK));
    if (lock[0]?.acquired !== true) throw new MigrationSafetyError('Another migration release owns the lock; no migrations executed.');
    locked = true;
    const tables = rows(await session.query("SELECT to_regclass('public.migrations')::text AS table_name"));
    if (typeof tables[0]?.table_name !== 'string') {
      throw new MigrationSafetyError('Missing migration ledger: a separately reviewed database bootstrap is required.');
    }
    const ledger = await session.query('SELECT "name", "timestamp"::text AS "timestamp" FROM public."migrations" ORDER BY "timestamp", "id"');
    const pending = pendingMigrationNames(registered, ledger);
    if (JSON.stringify(pending) !== JSON.stringify(command.expected)) {
      throw new MigrationSafetyError('Pending migrations differ from the complete ordered --expect list; no migrations executed.');
    }
    // Existing migrations contain unqualified table names. A role-specific
    // schema/search_path must not redirect an approved public-schema release.
    const target = rows(await session.query(`SELECT current_schema() AS schema_name, to_regclass('"user"') = to_regclass('public."user"') AS public_user`));
    if (target[0]?.schema_name !== 'public' || target[0]?.public_user !== true) {
      throw new MigrationSafetyError('Migration search_path must resolve the current schema and user table to public; verify the approved target.');
    }
    const applied = await session.executePending();
    if (JSON.stringify(applied) !== JSON.stringify(pending)) {
      throw new MigrationSafetyError('Executed migration names differ from the approved plan; investigate before any further release.');
    }
    return { kind: 'applied', names: applied };
  } finally {
    try {
      if (locked) await session.query('SELECT pg_advisory_unlock($1, $2)', RELEASE_LOCK);
    } finally {
      await session.close();
    }
  }
}
