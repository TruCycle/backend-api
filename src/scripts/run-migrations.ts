import 'reflect-metadata';
import { DataSource } from 'typeorm';
import configuration from '../config/configuration';
import { PostgisExtensionMigration1700000000001 } from '../database/migrations/1700000000001-CreatePostgisExtension';
import { User } from '../modules/users/user.entity';

async function run() {
  const cfg = configuration();
  const dataSource = new DataSource({
    type: 'postgres',
    host: cfg.db.host,
    port: cfg.db.port,
    username: cfg.db.user,
    password: cfg.db.password,
    database: cfg.db.name,
    entities: [User],
    migrations: [PostgisExtensionMigration1700000000001],
    logging: cfg.db.logging,
  });
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

