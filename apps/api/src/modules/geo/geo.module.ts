import { Module } from '@nestjs/common';
import { PostcodeService } from './postcode.service';

/**
 * Shared geocoding. Imported by test-centres (where the implementation started) and by
 * bookings (instructor proximity search), so there is one postcode implementation rather
 * than one per caller.
 */
@Module({
  providers: [PostcodeService],
  exports: [PostcodeService],
})
export class GeoModule {}
