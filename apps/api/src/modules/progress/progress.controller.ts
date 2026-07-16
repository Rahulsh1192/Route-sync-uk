import {
  Controller, Get, Post, Body, Param, Query, Request, UseGuards,
} from '@nestjs/common';
import { ProgressService } from './progress.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private svc: ProgressService) {}

  @Get('users/me/progress')
  getProgress(@Request() req: any) {
    return this.svc.getProgress(req.user.sub);
  }

  @Get('users/me/history')
  getHistory(@Request() req: any) {
    return this.svc.getHistory(req.user.sub);
  }

  @Post('routes/:id/session-complete')
  sessionComplete(
    @Request() req: any,
    @Param('id') routeId: string,
    @Body('sessionType') sessionType: 'watch' | 'practice',
  ) {
    return this.svc.onSessionComplete(req.user.sub, routeId, sessionType ?? 'watch');
  }

  @Get('routes/:id/summary')
  getSummary(
    @Request() req: any,
    @Param('id') routeId: string,
    @Query('type') sessionType: string,
  ) {
    return this.svc.getSummary(req.user.sub, routeId, sessionType ?? 'watch');
  }
}
