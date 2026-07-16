import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { OfflineController } from './offline.controller';
import { OfflineService } from './offline.service';
import { PrismaModule } from '../../database/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    SubscriptionsModule,
    StorageModule,
    BullModule.registerQueue({ name: 'offline-packages' }),
  ],
  controllers: [OfflineController],
  providers: [OfflineService],
  exports: [OfflineService],
})
export class OfflineModule {}
