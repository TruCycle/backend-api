import 'reflect-metadata';
import { DataSource } from 'typeorm';

import configuration from '../config/configuration';
import { PostgisExtensionMigration1700000000001 } from '../database/migrations/1700000000001-CreatePostgisExtension';
import { CreateUuidExtension1700000000002 } from '../database/migrations/1700000000002-CreateUuidExtension';
import { CreateUserKycAddress1700000000003 } from '../database/migrations/1700000000003-CreateUserKycAddress';
import { CreateServiceZoneAndSeedLondon1700000000004 } from '../database/migrations/1700000000004-CreateServiceZoneAndSeedLondon';
import { CreatePickupOrderAndItem1700000000005 } from '../database/migrations/1700000000005-CreatePickupOrderAndItem';
import { AddPendingStatusAndUserNames1700000000006 } from '../database/migrations/1700000000006-AddPendingStatusAndUserNames';
import { SetUserStatusDefaultPending1700000000007 } from '../database/migrations/1700000000007-SetUserStatusDefaultPending';
import { CreateItemListing1700000000008 } from '../database/migrations/1700000000008-CreateItemListing';
import { CreateClaimsTable1700000000009 } from '../database/migrations/1700000000009-CreateClaimsTable';
import { AddClaimApprovedAt1700000000010 } from '../database/migrations/1700000000010-AddClaimApprovedAt';
import { AddClaimCompletionAndScanEvents1700000000011 } from '../database/migrations/1700000000011-AddClaimCompletionAndScanEvents';
import { AddUserProfileImageAndItemCo2AndReviews1700000000012 } from '../database/migrations/1700000000012-AddUserProfileImageAndItemCo2AndReviews';
import { Role } from '../modules/users/role.entity';
import { UserRole } from '../modules/users/user-role.entity';
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
    entities: [User, Role, UserRole],
    migrations: [
      PostgisExtensionMigration1700000000001,
      CreateUuidExtension1700000000002,
      CreateUserKycAddress1700000000003,
      CreateServiceZoneAndSeedLondon1700000000004,
      CreatePickupOrderAndItem1700000000005,
      AddPendingStatusAndUserNames1700000000006,
      SetUserStatusDefaultPending1700000000007,
      CreateItemListing1700000000008,
      CreateClaimsTable1700000000009,
      AddClaimApprovedAt1700000000010,
      AddClaimCompletionAndScanEvents1700000000011,
      AddUserProfileImageAndItemCo2AndReviews1700000000012,
    ],
    logging: cfg.db.logging,
    migrationsTransactionMode: 'each',
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
