import { Global, Module } from '@nestjs/common';
import { MediaQueueService } from './media-queue.service';

@Global()
@Module({
  providers: [MediaQueueService],
  exports: [MediaQueueService],
})
export class QueueModule {}
