export interface DatabaseSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly name: string;
  readonly ssl: boolean;
  readonly logging: boolean;
}

// Runtime and release CLI share connection/TLS settings, but never startup DDL.
export function buildDatabaseOptions(settings: DatabaseSettings) {
  return {
    type: 'postgres' as const,
    host: settings.host,
    port: settings.port,
    username: settings.user,
    password: settings.password,
    database: settings.name,
    ssl: settings.ssl,
    logging: settings.logging,
    schema: 'public',
    migrationsTableName: 'migrations',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    // PostgresDriver.afterConnect otherwise attempts CREATE EXTENSION itself.
    installExtensions: false,
    migrationsTransactionMode: 'each' as const,
  };
}
