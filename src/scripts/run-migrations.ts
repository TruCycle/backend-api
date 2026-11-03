import type { QueryRunner } from 'typeorm';

import configuration from '../config/configuration';
import { buildDatabaseOptions } from '../database/database-options';
import { migrationRegistry, registeredMigrationNames } from '../database/migration-registry';
import { createMigrationReleaseLogger, MigrationSafetyError, runMigrationCommand } from '../database/migration-release';
import type { MigrationReleaseSession } from '../database/migration-release';

// This factory is reached only after both explicit apply flags validate.
async function createReleaseSession(): Promise<MigrationReleaseSession> {
  await import('dotenv/config');
  await import('reflect-metadata');
  const { DataSource, MigrationExecutor } = await import('typeorm');
  const dataSource = new DataSource({
    ...buildDatabaseOptions(configuration().db),
    logging: false,
    logger: createMigrationReleaseLogger(),
    entities: [],
    migrations: migrationRegistry,
  });
  let connectedRunner: QueryRunner | undefined;
  try {
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    connectedRunner = queryRunner;
    await queryRunner.connect();
    return {
      query: (sql, parameters) => queryRunner.query(sql, parameters),
      executePending: async () => {
        // Reuse the locked connection for preflight and execution, including
        // each migration transaction. Other release CLI processes use this lock.
        const executor = new MigrationExecutor(dataSource, queryRunner);
        executor.transaction = 'each';
        const applied = await executor.executePendingMigrations();
        return applied.map((migration) => migration.name);
      },
      close: async () => {
        try {
          if (!queryRunner.isReleased) await queryRunner.release();
        } finally {
          if (dataSource.isInitialized) await dataSource.destroy();
        }
      },
    };
  } catch (error) {
    try {
      if (connectedRunner && !connectedRunner.isReleased) await connectedRunner.release();
    } finally {
      if (dataSource.isInitialized) await dataSource.destroy();
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const result = await runMigrationCommand(process.argv.slice(2), registeredMigrationNames, createReleaseSession);
  // This is an offline registry listing, never a claim about database status.
  console.log(result.kind === 'list' ? 'Offline registered migration history (database not inspected):' : 'Applied migrations:');
  result.names.forEach((name) => console.log(name));
  if (result.kind === 'list') {
    console.log('Release execution requires --apply and an explicitly reviewed complete --expect list. Fresh databases require a separate bootstrap procedure.');
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    // Do not dump connection settings, query parameters or duplicate subject IDs.
    console.error(error instanceof MigrationSafetyError ? error.message : 'Migration release failed; inspect restricted operational logs before retrying.');
    process.exitCode = 1;
  });
}
