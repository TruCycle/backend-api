import { readFileSync, readdirSync } from 'fs';
import path from 'path';

import ts from 'typescript';

import configuration from '../config/configuration';

import { buildDatabaseOptions } from './database-options';
import {
  createMigrationReleaseLogger,
  MigrationSafetyError,
  parseMigrationCommand,
  pendingMigrationNames,
  runMigrationCommand,
} from './migration-release';

const names = ['First1700000000001', 'Second1700000000002', 'Third1700000000003'];
const initialLedger = [{ name: names[0], timestamp: '1700000000001' }];
const applyArgs = ['--apply', '--expect', names.slice(1).join(',')];
const repoRoot = path.resolve(__dirname, '../..');

function fakeSession() {
  const session = {
    query: jest.fn<Promise<unknown>, [string, unknown[]?]>(async (sql) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ acquired: true }];
      if (sql.includes('current_schema')) return [{ schema_name: 'public', public_user: true }];
      if (sql.includes('to_regclass')) return [{ table_name: 'migrations' }];
      if (sql.includes('FROM public.')) return initialLedger;
      return [];
    }),
    executePending: jest.fn(async () => names.slice(1)),
    close: jest.fn(async () => {}),
  };
  return { session, createSession: jest.fn(async () => session) };
}

describe('Migration release boundary (no database or migration imports)', () => {
  it.each([[], ['--list']])('lists offline without constructing a connection for %j', async (...parameters) => {
    // Jest expands each row, so reconstruct the intended argv explicitly.
    const args = parameters.length === 0 ? [] : parameters as string[];
    const f = fakeSession();
    expect(await runMigrationCommand(args, names, f.createSession)).toEqual({ kind: 'list', names });
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['--apply'], ['--expect', names[1]], ['--list', '--apply'], ['--unknown'],
    ['--apply', '--apply', '--expect', names[1]],
    ['--apply', '--expect'], ['--apply', '--expect', ''],
    ['--apply', '--expect', 'Unregistered1700000000009'],
    ['--apply', '--expect', `${names[1]},${names[1]}`],
    ['--apply', '--expect', names[1], '--expect', names[2]],
  ])('rejects invalid argv before opening a connection: %j', async (...args) => {
    const f = fakeSession();
    await expect(runMigrationCommand(args, names, f.createSession)).rejects.toBeInstanceOf(MigrationSafetyError);
    expect(f.createSession).not.toHaveBeenCalled();
  });

  it('requires the exact pending order, not a partial name list', async () => {
    for (const expected of [names[1], names.slice(1).reverse().join(',')]) {
      const f = fakeSession();
      await expect(runMigrationCommand(['--apply', '--expect', expected], names, f.createSession)).rejects.toThrow('differ');
      expect(f.session.executePending).not.toHaveBeenCalled();
      expect(f.session.close).toHaveBeenCalledTimes(1);
      expect(f.session.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock');
    }
  });

  it('holds the same session lock over SELECT-only preflight and explicit execution', async () => {
    const f = fakeSession();
    f.session.executePending.mockImplementation(async () => {
      expect(f.session.close).not.toHaveBeenCalled();
      expect(f.session.query.mock.calls.some(([sql]) => sql.includes('pg_advisory_unlock'))).toBe(false);
      return names.slice(1);
    });
    expect(await runMigrationCommand(applyArgs, names, f.createSession)).toEqual({ kind: 'applied', names: names.slice(1) });
    expect(f.session.executePending).toHaveBeenCalledTimes(1);
    expect(f.session.query.mock.calls.every(([sql]) => /^SELECT /.test(sql))).toBe(true);
    expect(f.session.query.mock.calls[0][1]).toEqual(f.session.query.mock.calls.at(-1)?.[1]);
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });

  it('fails closed if another release holds the lock', async () => {
    const f = fakeSession();
    f.session.query.mockResolvedValueOnce([{ acquired: false }]);
    await expect(runMigrationCommand(applyArgs, names, f.createSession)).rejects.toThrow('owns the lock');
    expect(f.session.query).toHaveBeenCalledTimes(1);
    expect(f.session.executePending).not.toHaveBeenCalled();
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });

  it('requires separate bootstrap when the ledger is missing', async () => {
    const f = fakeSession();
    f.session.query.mockResolvedValueOnce([{ acquired: true }]).mockResolvedValueOnce([{ table_name: null }]);
    await expect(runMigrationCommand(applyArgs, names, f.createSession)).rejects.toThrow('bootstrap');
    expect(f.session.executePending).not.toHaveBeenCalled();
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });

  it('unlocks and closes on a preflight query error', async () => {
    const f = fakeSession();
    f.session.query.mockResolvedValueOnce([{ acquired: true }]).mockRejectedValueOnce(new Error('synthetic read failure'));
    await expect(runMigrationCommand(applyArgs, names, f.createSession)).rejects.toThrow('synthetic read failure');
    expect(f.session.executePending).not.toHaveBeenCalled();
    expect(f.session.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock');
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });

  it('unlocks and closes when migration execution fails', async () => {
    const f = fakeSession();
    f.session.executePending.mockRejectedValue(new Error('synthetic execution failure'));
    await expect(runMigrationCommand(applyArgs, names, f.createSession)).rejects.toThrow('synthetic execution failure');
    expect(f.session.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock');
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });

  it('still closes the session if releasing its lock fails', async () => {
    const f = fakeSession();
    const query = f.session.query.getMockImplementation()!;
    f.session.query.mockImplementation(async (sql, parameters) => {
      if (sql.includes('pg_advisory_unlock')) throw new Error('synthetic unlock failure');
      return query(sql, parameters);
    });
    await expect(runMigrationCommand(applyArgs, names, f.createSession)).rejects.toThrow('synthetic unlock failure');
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });

  it('checks the executed names without automatically reverting schema', async () => {
    const f = fakeSession();
    f.session.executePending.mockResolvedValue([names[1]]);
    await expect(runMigrationCommand(applyArgs, names, f.createSession)).rejects.toThrow('Executed migration names differ');
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a search_path that could redirect unqualified migration SQL', async () => {
    const f = fakeSession();
    const query = f.session.query.getMockImplementation()!;
    f.session.query.mockImplementation(async (sql, parameters) => {
      if (sql.includes('current_schema')) return [{ schema_name: 'private_shadow', public_user: false }];
      return query(sql, parameters);
    });
    await expect(runMigrationCommand(applyArgs, names, f.createSession)).rejects.toThrow('search_path');
    expect(f.session.executePending).not.toHaveBeenCalled();
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    [],
    [{ name: 'Unknown1700000000099', timestamp: '1700000000099' }],
    [...initialLedger, ...initialLedger],
    [{ name: names[0], timestamp: 'wrong' }],
    [{ name: names[1], timestamp: '1700000000002' }],
  ])('rejects empty, unknown, duplicate, mismatched or gapped history %j', (...ledger) => {
    expect(() => pendingMigrationNames(names, ledger)).toThrow(MigrationSafetyError);
  });

  it('accepts only unique ascending registered timestamps', () => {
    expect(() => pendingMigrationNames([names[0], names[0]], initialLedger)).toThrow(MigrationSafetyError);
    expect(() => pendingMigrationNames([...names].reverse(), initialLedger)).toThrow(MigrationSafetyError);
    expect(parseMigrationCommand(applyArgs, names)).toEqual({ kind: 'apply', expected: names.slice(1) });
  });

  it.each([false, true])('shares TLS=%s while prohibiting every automatic startup DDL option', (ssl) => {
    const settings = { host: 'synthetic.invalid', port: 5432, user: 'test-user', password: 'not-a-secret', name: 'test-db', ssl, logging: true,
      synchronize: true, migrationsRun: true, dropSchema: true, installExtensions: true };
    const options = buildDatabaseOptions(settings);
    expect(options).toMatchObject({ ssl, synchronize: false, migrationsRun: false, dropSchema: false, installExtensions: false });
    expect(options.username).toBe(settings.user);
    expect(options.database).toBe(settings.name);
  });

  it('legacy environment sync settings cannot re-enable schema mutation', () => {
    const previous = process.env.TYPEORM_SYNC;
    try {
      process.env.TYPEORM_SYNC = 'true';
      expect(configuration().db.synchronize).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TYPEORM_SYNC;
      else process.env.TYPEORM_SYNC = previous;
    }
  });

  it('release logging never prints raw SQL, parameters or database identity errors', () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug'].map((method) => jest.spyOn(console, method as 'log').mockImplementation(() => {}));
    try {
      const logger = createMigrationReleaseLogger();
      const sentinel = 'PRIVATE_GOOGLE_SUBJECT_SENTINEL';
      logger.logMigration(sentinel);
      logger.logQuery('synthetic SQL', [sentinel]);
      logger.logQueryError(sentinel, 'synthetic SQL', [sentinel]);
      logger.logQuerySlow(100, 'synthetic SQL', [sentinel]);
      logger.logSchemaBuild(sentinel);
      logger.log('warn', sentinel);
      spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    } finally { spies.forEach((spy) => spy.mockRestore()); }
  });

  it('the single AST registry covers every tracked migration in timestamp order without importing migrations', () => {
    const registryPath = path.join(repoRoot, 'src/database/migration-registry.ts');
    const source = ts.createSourceFile(registryPath, readFileSync(registryPath, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = new Map<string, string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        bindings.elements.forEach((element) => imports.set(element.name.text, statement.moduleSpecifier.getText(source).slice(1, -1)));
      }
    }
    const declarations = source.statements.filter(ts.isVariableStatement).flatMap((statement) => [...statement.declarationList.declarations]);
    const registry = declarations.find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'migrationRegistry')?.initializer;
    expect(registry && ts.isArrayLiteralExpression(registry)).toBe(true);
    if (!registry || !ts.isArrayLiteralExpression(registry)) throw new Error('Missing explicit registry');
    const paths = registry.elements.map((element) => {
      if (!ts.isIdentifier(element)) throw new Error('Registry must use explicit imported classes');
      const imported = imports.get(element.text);
      if (!imported) throw new Error('Unbound migration');
      const filename = path.resolve(path.dirname(registryPath), `${imported}.ts`);
      const migration = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
      const definition = migration.statements.find(ts.isClassDeclaration);
      expect(definition?.name?.text).toBe(element.text);
      const declaredName = definition?.members.find((member) => ts.isPropertyDeclaration(member) && member.name.getText(migration) === 'name');
      if (declaredName && ts.isPropertyDeclaration(declaredName)) {
        expect(declaredName.initializer && ts.isStringLiteral(declaredName.initializer) ? declaredName.initializer.text : undefined).toBe(element.text);
      }
      expect(element.text.slice(-13)).toBe(path.basename(filename).slice(0, 13));
      return path.basename(filename);
    });
    const tracked = readdirSync(path.join(repoRoot, 'src/database/migrations')).filter((file) => /^\d{13}-.+\.ts$/.test(file)).sort();
    expect(paths).toEqual(tracked);
    expect(paths).toHaveLength(32);
    const app = readFileSync(path.join(repoRoot, 'src/app.module.ts'), 'utf8');
    const runner = readFileSync(path.join(repoRoot, 'src/scripts/run-migrations.ts'), 'utf8');
    expect(app).toContain('migrations: migrationRegistry');
    expect(runner).toContain('migrations: migrationRegistry');
    expect(app).not.toContain("from './database/migrations/");
    expect(runner).not.toContain("from '../database/migrations/");
  });
});


describe('Prepared lifecycle schema privacy and rollback boundary (source only)', () => {
  it('keeps observations private, historical timestamps nullable, and rollback fail-closed', () => {
    const source = readFileSync(path.join(repoRoot, 'src/database/migrations/1700000000028-FoundItemLifecycle.ts'), 'utf8');
    expect(source).toContain('ENABLE ROW LEVEL SECURITY');
    expect(source).toContain('REVOKE ALL ON TABLE found_item_observation FROM PUBLIC');
    expect(source).toContain("['anon','authenticated']");
    expect(source).toContain('UNIQUE(found_item_id, observer_id)');
    expect(source).toContain('last_seen_at timestamptz NULL');
    expect(source).toContain('throw new Error');
    expect(source).not.toMatch(/GRANT\s|CREATE POLICY|auth\.uid\(|DROP TABLE|DELETE FROM|UPDATE found_item/i);
    expect(source).not.toMatch(/latitude|longitude|requester_ip/i);
  });
});
