import { Module } from '@nestjs/common';
import { TestCentresController } from './test-centres.controller';
import { TestCentresService } from './test-centres.service';

@Module({
  controllers: [TestCentresController],
  providers: [TestCentresService],
  exports: [TestCentresService],
})
export class TestCentresModule {}
