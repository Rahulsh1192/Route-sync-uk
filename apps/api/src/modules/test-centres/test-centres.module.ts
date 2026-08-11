import { Module } from '@nestjs/common';
import { TestCentresController } from './test-centres.controller';
import { TestCentresService } from './test-centres.service';
import { GeoModule } from '../geo/geo.module';

@Module({
  imports: [GeoModule],
  controllers: [TestCentresController],
  providers: [TestCentresService],
  exports: [TestCentresService],
})
export class TestCentresModule {}
