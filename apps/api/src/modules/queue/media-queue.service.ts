import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const MEDIA_JOBS_KEY = 'media:jobs';

export interface MediaJob {
  uploadId: string;
  type: 'process_route';
  enqueuedAt: string;
}

/**
 * Cross-language hand-off to the Python media pipeline. The API pushes JSON jobs
 * onto a Redis list; the Python worker BRPOPs them. (App-only jobs — email,
 * notifications — use BullMQ separately; media jobs stay language-neutral.)
 */
@Injectable()
export class MediaQueueService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.get<string>('REDIS_URL')!);
  }

  async enqueueProcessRoute(uploadId: string): Promise<void> {
    const job: MediaJob = {
      uploadId,
      type: 'process_route',
      enqueuedAt: new Date().toISOString(),
    };
    await this.redis.lpush(MEDIA_JOBS_KEY, JSON.stringify(job));
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
