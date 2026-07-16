import { Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private svc: NotificationsService) {}

  @Post('register')
  registerDevice(
    @Request() req: any,
    @Body('platform') platform: 'ios' | 'android',
    @Body('token') token: string,
  ) {
    return this.svc.registerDevice(req.user.sub, platform, token);
  }

  @Delete('register/:token')
  unregisterDevice(@Param('token') token: string) {
    return this.svc.unregisterDevice(token);
  }

  @Get()
  getNotifications(@Request() req: any) {
    return this.svc.getNotifications(req.user.sub);
  }

  @Patch(':id/read')
  markRead(@Request() req: any, @Param('id') id: string) {
    return this.svc.markRead(req.user.sub, id);
  }
}
