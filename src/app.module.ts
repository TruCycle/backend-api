import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from './config/configuration';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ShopsModule } from './modules/shops/shops.module';
import { ItemsModule } from './modules/items/items.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { QrModule } from './modules/qr/qr.module';
import { SearchModule } from './modules/search/search.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { GeoModule } from './geo/geo.module';
import { PostgisExtensionMigration1700000000001 } from './database/migrations/1700000000001-CreatePostgisExtension';
import { CreateUuidExtension1700000000002 } from './database/migrations/1700000000002-CreateUuidExtension';
import { CreateUserKycAddress1700000000003 } from './database/migrations/1700000000003-CreateUserKycAddress';
import { CreateServiceZoneAndSeedLondon1700000000004 } from './database/migrations/1700000000004-CreateServiceZoneAndSeedLondon';
import { CreatePickupOrderAndItem1700000000005 } from './database/migrations/1700000000005-CreatePickupOrderAndItem';
import { AddPendingStatusAndUserNames1700000000006 } from './database/migrations/1700000000006-AddPendingStatusAndUserNames';
import { SetUserStatusDefaultPending1700000000007 } from './database/migrations/1700000000007-SetUserStatusDefaultPending';
import { User } from './modules/users/user.entity';
import { AddressesModule } from './modules/addresses/addresses.module';
import { OrdersModule } from './modules/orders/orders.module';
import { MediaModule } from './modules/media/media.module';
import { JwtAuthModule } from './common/security/jwt-auth.module';

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
  SearchModule,
  NotificationsModule,
  AdminModule,
  MediaModule,
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
          entities: [User],
          migrations: [
            PostgisExtensionMigration1700000000001,
            CreateUuidExtension1700000000002,
            CreateUserKycAddress1700000000003,
            CreateServiceZoneAndSeedLondon1700000000004,
            CreatePickupOrderAndItem1700000000005,
            AddPendingStatusAndUserNames1700000000006,
            SetUserStatusDefaultPending1700000000007,
          ],
          migrationsRun: true,
          migrationsTransactionMode: 'each',
        }),
      }),
      UsersModule,
      AddressesModule,
      OrdersModule,
    ]
  : [];

@Module({
  imports: [...baseModules, ...dbModules],
})
export class AppModule {}
