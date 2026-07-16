import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { AiSummaryProcessor } from './ai-summary.processor';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'ai-summaries' }),
  ],
  controllers: [ProgressController],
  providers: [ProgressService, AiSummaryProcessor],
  exports: [ProgressService],
})
export class ProgressModule {}
