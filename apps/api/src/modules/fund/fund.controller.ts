import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FundService } from './fund.service';

/**
 * Public transparency endpoints for the Instructor Community Fund.
 * No authentication — these figures are intended to be openly auditable.
 */
@ApiTags('fund')
@Controller('fund')
export class FundController {
  constructor(private readonly fund: FundService) {}

  @Get('summary')
  summary() {
    return this.fund.summary();
  }

  @Get('reports')
  reports(@Query('year') year?: string) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.fund.reports(y);
  }
}
