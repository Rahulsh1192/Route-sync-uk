import { Global, Module } from '@nestjs/common';
import { FundService } from './fund.service';
import { FundController } from './fund.controller';

// Global so AdminService can reuse FundService for admin-side fund actions.
@Global()
@Module({
  controllers: [FundController],
  providers: [FundService],
  exports: [FundService],
})
export class FundModule {}
