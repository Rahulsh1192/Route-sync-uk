import { Global, Module } from '@nestjs/common';
import { RevshareService } from './revshare.service';

// Global so RoutesController (watch logging) and AdminService (reporting) can
// both reuse RevshareService without re-importing the module.
@Global()
@Module({
  providers: [RevshareService],
  exports: [RevshareService],
})
export class RevshareModule {}
