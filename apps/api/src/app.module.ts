import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import { loadConfig } from './config/configuration';
import { PrismaModule } from './database/prisma.module';
import { StorageModule } from './modules/storage/storage.module';
import { QueueModule } from './modules/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { RoutesModule } from './modules/routes/routes.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { SearchModule } from './modules/search/search.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AdminModule } from './modules/admin/admin.module';
import { CommunityModule } from './modules/community/community.module';
import { FundModule } from './modules/fund/fund.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ProgressModule } from './modules/progress/progress.module';
import { OfflineModule } from './modules/offline/offline.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // validate env once at startup; throws on misconfiguration
      validate: (config) => loadConfig(config),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]), // 120 req/min/IP default
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    QueueModule,
    SubscriptionsModule, // global — provides EntitlementGuard dependency
    AuthModule,
    UsersModule,
    RoutesModule,
    UploadsModule,
    SearchModule,
    WebhooksModule,
    AdminModule,
    CommunityModule,
    FundModule,
    BookingsModule,
    ProgressModule,
    OfflineModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
