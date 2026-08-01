import { Module } from '@nestjs/common';
import { JourneysService } from './journeys.service';
import { InternalJourneysController, JourneysController } from './journeys.controller';

@Module({
  controllers: [JourneysController, InternalJourneysController],
  providers: [JourneysService],
  exports: [JourneysService],
})
export class JourneysModule {}
