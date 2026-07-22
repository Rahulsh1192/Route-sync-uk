import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  // Phase 20: one global query term across title / instructor / centre / town / postcode.
  @Get('routes')
  routes(@Query('q') q?: string) {
    return this.search.routes(q);
  }

  @Get('test-centres')
  testCentres(@Query('near') near?: string, @Query('q') q?: string) {
    // ?near=lat,lng → nearest (PostGIS KNN); otherwise a name/town/postcode list.
    if (near) {
      const [lat, lng] = near.split(',').map(Number);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        throw new BadRequestException('near must be "lat,lng"');
      }
      return this.search.testCentresNear(lat, lng);
    }
    return this.search.testCentresSearch(q);
  }
}
