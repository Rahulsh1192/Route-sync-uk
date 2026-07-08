import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RoutesService } from './routes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('routes')
@Controller('routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  list(@Query('cursor') cursor?: string, @Query('take') take?: string) {
    return this.routes.list({ cursor, take: take ? parseInt(take, 10) : undefined });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.routes.detail(id);
  }

  @Get(':id/playback')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  playback(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routes.playback(user.id, id);
  }

  @Get(':id/practice')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  practice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routes.practice(user.id, id);
  }
}
