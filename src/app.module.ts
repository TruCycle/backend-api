import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthModule } from './common/security/jwt-auth.module';
import configuration from './config/configuration';
import { PostgisExtensionMigration1700000000001 } from './database/migrations/1700000000001-CreatePostgisExtension';
import { CreateUuidExtension1700000000002 } from './database/migrations/1700000000002-CreateUuidExtension';
import { CreateUserKycAddress1700000000003 } from './database/migrations/1700000000003-CreateUserKycAddress';
import { CreateServiceZoneAndSeedLondon1700000000004 } from './database/migrations/1700000000004-CreateServiceZoneAndSeedLondon';
import { CreatePickupOrderAndItem1700000000005 } from './database/migrations/1700000000005-CreatePickupOrderAndItem';
import { AddPendingStatusAndUserNames1700000000006 } from './database/migrations/1700000000006-AddPendingStatusAndUserNames';
import { SetUserStatusDefaultPending1700000000007 } from './database/migrations/1700000000007-SetUserStatusDefaultPending';
import { CreateItemListing1700000000008 } from './database/migrations/1700000000008-CreateItemListing';
import { CreateClaimsTable1700000000009 } from './database/migrations/1700000000009-CreateClaimsTable';
import { AddClaimApprovedAt1700000000010 } from './database/migrations/1700000000010-AddClaimApprovedAt';
import { AddClaimCompletionAndScanEvents1700000000011 } from './database/migrations/1700000000011-AddClaimCompletionAndScanEvents';
import { AddUserProfileImageAndItemCo2AndReviews1700000000012 } from './database/migrations/1700000000012-AddUserProfileImageAndItemCo2AndReviews';
import { CreateMessagesTables1700000000013 } from './database/migrations/1700000000013-CreateMessagesTables';
import { GeoModule } from './geo/geo.module';
import { AuthModule } from './modules/auth/auth.module';
import { Claim } from './modules/claims/claim.entity';
import { ClaimsModule } from './modules/claims/claims.module';
import { Item } from './modules/items/item.entity';
import { ItemsModule } from './modules/items/items.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { QrModule } from './modules/qr/qr.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
// Removed modules: Addresses, Admin, Media, Orders, Search
import { ShopsModule } from './modules/shops/shops.module';
import { User } from './modules/users/user.entity';
import { UsersModule } from './modules/users/users.module';
import { MessagesModule } from './modules/messages/messages.module';
import { MessageRoom } from './modules/messages/message-room.entity';
import { Message } from './modules/messages/message.entity';

// Enable DB explicitly via ENABLE_DB=true; default is disabled to allow quick boot
const enableDb = process.env.ENABLE_DB === 'true';

const baseModules: any[] = [
  ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
  JwtAuthModule,
  GeoModule,
  AuthModule,
  ShopsModule,
  ItemsModule,
  ClaimsModule,
  QrModule,
  NotificationsModule,
  ReviewsModule,
];

const dbModules: any[] = enableDb
  ? [
      TypeOrmModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          type: 'postgres',
          host: config.get<string>('db.host'),
          port: config.get<number>('db.port'),
          username: config.get<string>('db.user'),
          password: config.get<string>('db.password'),
          database: config.get<string>('db.name'),
          ssl: config.get<boolean>('db.ssl') || false,
          autoLoadEntities: true,
          synchronize: config.get<boolean>('db.synchronize') || false,
          logging: config.get<boolean>('db.logging') || false,
          entities: [User, Item, Claim, MessageRoom, Message],
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
            CreateMessagesTables1700000000013,
          ],
          migrationsRun: true,
          migrationsTransactionMode: 'each',
        }),
      }),
      UsersModule,
      MessagesModule,
    ]
  : [];

@Module({
  imports: [...baseModules, ...dbModules],
})
export class AppModule {}



