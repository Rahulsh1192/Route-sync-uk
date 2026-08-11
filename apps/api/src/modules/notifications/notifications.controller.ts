import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private svc: NotificationsService) {}

  @Post('register')
  registerDevice(
    @CurrentUser() user: AuthUser,
    @Body('platform') platform: 'ios' | 'android',
    @Body('token') token: string,
  ) {
    return this.svc.registerDevice(user.id, platform, token);
  }

  @Delete('register/:token')
  unregisterDevice(@Param('token') token: string) {
    return this.svc.unregisterDevice(token);
  }

  @Get()
  getNotifications(@CurrentUser() user: AuthUser) {
    return this.svc.getNotifications(user.id);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.markRead(user.id, id);
  }
}
