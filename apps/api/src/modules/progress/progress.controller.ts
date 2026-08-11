import {
  Controller, Get, Post, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ProgressService } from './progress.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private svc: ProgressService) {}

  @Get('users/me/progress')
  getProgress(@CurrentUser() user: AuthUser) {
    return this.svc.getProgress(user.id);
  }

  @Get('users/me/history')
  getHistory(@CurrentUser() user: AuthUser) {
    return this.svc.getHistory(user.id);
  }

  @Post('routes/:id/session-complete')
  sessionComplete(
    @CurrentUser() user: AuthUser,
    @Param('id') routeId: string,
    @Body('sessionType') sessionType: 'watch' | 'practice',
  ) {
    return this.svc.onSessionComplete(user.id, routeId, sessionType ?? 'watch');
  }

  @Get('routes/:id/summary')
  getSummary(
    @CurrentUser() user: AuthUser,
    @Param('id') routeId: string,
    @Query('type') sessionType: string,
  ) {
    return this.svc.getSummary(user.id, routeId, sessionType ?? 'watch');
  }
}
