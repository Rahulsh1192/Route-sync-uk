import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UploadsService } from './uploads.service';
import { CompleteMultipartDto, InitUploadDto, SignPartsDto } from './dto/uploads.dto';
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

  // Phase 25 — multipart upload for large files (several GB of dashcam footage).
  // Added rather than replacing the single-PUT flow: small files keep the cheaper
  // one-request path, and `POST /uploads` tells the client which one to use.

  /** Sign the next batch of parts. Re-callable, which is what makes resume work. */
  @Post(':id/parts')
  @Roles('instructor', 'admin')
  signParts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignPartsDto,
  ) {
    return this.uploads.signParts(user.id, id, dto.fileId, dto.partNumbers);
  }

  /** Assemble the uploaded parts into the final object. */
  @Post(':id/parts/complete')
  @Roles('instructor', 'admin')
  completeMultipart(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteMultipartDto,
  ) {
    return this.uploads.completeMultipart(user.id, id, dto.fileId, dto.parts);
  }

  /**
   * Cancel an upload and release whatever it already put in the bucket.
   *
   * Only ever removes objects nothing else references, so a cancelled upload can never
   * take a published video with it.
   */
  @Delete(':id')
  @Roles('instructor', 'admin')
  abort(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.abort(user.id, id);
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
