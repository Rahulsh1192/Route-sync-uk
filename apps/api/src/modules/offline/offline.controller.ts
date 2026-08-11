import { Controller, Get, Post, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { OfflineService } from './offline.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class OfflineController {
  constructor(private svc: OfflineService) {}

  @Post('routes/:id/offline')
  requestPackage(
    @CurrentUser() user: AuthUser,
    @Param('id') routeId: string,
    @Body('deviceId') deviceId: string,
  ) {
    return this.svc.requestPackage(user.id, routeId, deviceId ?? 'default');
  }

  @Get('routes/:id/offline')
  getPackageUrl(@CurrentUser() user: AuthUser, @Param('id') routeId: string) {
    return this.svc.getPackageUrl(user.id, routeId);
  }

  @Delete('routes/:id/offline')
  revokePackage(@CurrentUser() user: AuthUser, @Param('id') routeId: string) {
    return this.svc.revokePackage(user.id, routeId);
  }

  @Get('users/me/offline')
  listPackages(@CurrentUser() user: AuthUser) {
    return this.svc.listPackages(user.id);
  }
}
