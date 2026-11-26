import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthModule } from './common/security/jwt-auth.module';
import configuration from './config/configuration';
import { buildDatabaseOptions } from './database/database-options';
import { migrationRegistry } from './database/migration-registry';
import { GeoModule } from './geo/geo.module';
import { AuthModule } from './modules/auth/auth.module';
import { Claim } from './modules/claims/claim.entity';
import { ClaimsModule } from './modules/claims/claims.module';
import { FoundItemsModule } from './modules/found-items/found-items.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { Item } from './modules/items/item.entity';
import { ItemsModule } from './modules/items/items.module';
import { MessageRoom } from './modules/messages/message-room.entity';
import { Message } from './modules/messages/message.entity';
import { MessagesModule } from './modules/messages/messages.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { QrModule } from './modules/qr/qr.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
// Removed modules: Addresses, Admin, Media, Orders, Search
import { RewardsModule } from './modules/rewards/rewards.module';
import { Shop } from './modules/shops/shop.entity';
import { ShopsModule } from './modules/shops/shops.module';
import { User } from './modules/users/user.entity';
import { UsersModule } from './modules/users/users.module';

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
        ...buildDatabaseOptions({
          host: config.getOrThrow<string>('db.host'),
          port: config.getOrThrow<number>('db.port'),
          user: config.getOrThrow<string>('db.user'),
          password: config.getOrThrow<string>('db.password'),
          name: config.getOrThrow<string>('db.name'),
          ssl: config.get<boolean>('db.ssl') ?? false,
          logging: config.get<boolean>('db.logging') ?? false,
        }),
        autoLoadEntities: true,
        entities: [User, Item, Claim, MessageRoom, Message, Shop],
        migrations: migrationRegistry,
      }),
    }),
    UsersModule,
    MessagesModule,
    RewardsModule,
    GamificationModule,
    FoundItemsModule,
  ]
  : [];

@Module({
  imports: [...baseModules, ...dbModules],
})
export class AppModule { }


