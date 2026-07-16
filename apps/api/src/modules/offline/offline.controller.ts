import { Controller, Get, Post, Delete, Param, Query, Body, Request, UseGuards } from '@nestjs/common';
import { OfflineService } from './offline.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class OfflineController {
  constructor(private svc: OfflineService) {}

  @Post('routes/:id/offline')
  requestPackage(
    @Request() req: any,
    @Param('id') routeId: string,
    @Body('deviceId') deviceId: string,
  ) {
    return this.svc.requestPackage(req.user.sub, routeId, deviceId ?? 'default');
  }

  @Get('routes/:id/offline')
  getPackageUrl(@Request() req: any, @Param('id') routeId: string) {
    return this.svc.getPackageUrl(req.user.sub, routeId);
  }

  @Delete('routes/:id/offline')
  revokePackage(@Request() req: any, @Param('id') routeId: string) {
    return this.svc.revokePackage(req.user.sub, routeId);
  }

  @Get('users/me/offline')
  listPackages(@Request() req: any) {
    return this.svc.listPackages(req.user.sub);
  }
}
