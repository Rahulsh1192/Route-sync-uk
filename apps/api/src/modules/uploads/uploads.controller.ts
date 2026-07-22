import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UploadsService } from './uploads.service';
import { InitUploadDto } from './dto/uploads.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  // Phase 20: only instructors/admins may upload routes (students view only).
  @Post()
  @Roles('instructor', 'admin')
  init(@CurrentUser() user: AuthUser, @Body() dto: InitUploadDto) {
    return this.uploads.init(user.id, dto);
  }

  @Post(':id/complete')
  @Roles('instructor', 'admin')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.uploads.complete(user.id, id);
  }

  @Get(':id')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.uploads.status(user.id, id);
  }

  /** Phase 14: Any verified ADI can attach video to an existing map_only route. */
  @Post('routes/:routeId/attach-video')
  @Roles('instructor', 'admin')
  attachVideo(
    @CurrentUser() user: AuthUser,
    @Param('routeId') routeId: string,
    @Body('files') files: Array<{ kind: string; originalName: string; contentType: string; bytes: number }>,
  ) {
    return this.uploads.attachVideo(user.id, routeId, files);
  }
}
