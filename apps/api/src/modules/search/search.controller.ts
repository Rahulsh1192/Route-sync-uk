import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('routes')
  routes(
    @Query('testCentre') testCentre?: string,
    @Query('town') town?: string,
    @Query('postcode') postcode?: string,
    @Query('difficulty') difficulty?: string,
    @Query('contributor') contributor?: string,
    @Query('instructor') instructor?: string,
    @Query('q') q?: string,
  ) {
    return this.search.routes({
      testCentre,
      town,
      postcode,
      difficulty,
      contributor,
      instructor: instructor === undefined ? undefined : instructor === 'true',
      q,
    });
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
