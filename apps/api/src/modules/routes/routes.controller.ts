import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RoutesService } from './routes.service';
import { RevshareService } from '../revshare/revshare.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class WatchDto {
  @IsInt() @Min(0) @Max(86_400) secondsWatched!: number;
  @IsOptional() @IsIn(['playback', 'practice']) source?: 'playback' | 'practice';
}

@ApiTags('routes')
@Controller('routes')
export class RoutesController {
  constructor(
    private readonly routes: RoutesService,
    private readonly revshare: RevshareService,
  ) {}

  @Get()
  list(@Query('cursor') cursor?: string, @Query('take') take?: string) {
    return this.routes.list({ cursor, take: take ? parseInt(take, 10) : undefined });
  }

  // An instructor's published routes + the test centres they cover.
  @Get('by-instructor/:userId')
  byInstructor(@Param('userId') userId: string) {
    return this.routes.byInstructor(userId);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.routes.detail(id);
  }

  // Dry-run access check: tells the client whether to open the route, collect
  // test details, or show the paywall — without claiming the demo route.
  @Get(':id/access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  routeAccess(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routes.access(user.id, id);
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

  /**
   * Signed HLS gateway: authorises one playlist/segment request against a playback token.
   *
   * No `JwtAuthGuard`, deliberately — a video element's segment requests carry no
   * Authorization header, so the path token issued by `/playback` is the credential. It is
   * HMAC-signed, bound to this route and the user it was issued to, and expires;
   * `hlsAsset` verifies it before resolving anything.
   *
   * Playlists are returned inline (a couple of kilobytes of text, whose relative segment
   * references then resolve back through this same gateway). Media is a 302 to a
   * short-lived presigned URL, so the API authorises the request but never carries the
   * video itself.
   */
  @Get(':id/hls/:token/:view/:file')
  async hlsAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('token') token: string,
    @Param('view') view: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    const asset = await this.routes.hlsAsset(id, token, view, file);
    // Never cache: playlists are entitlement-gated and the redirect targets expire.
    res.set('Cache-Control', 'private, no-store');
    if (asset.kind === 'playlist') {
      res.type('application/vnd.apple.mpegurl').send(asset.body);
      return;
    }
    res.redirect(302, asset.url);
  }

  // Phase 24: the route's GPS track on the playback clock — drives the moving map
  // marker. Also served inside /playback; this exists for map-without-video cases.
  @Get(':id/track')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  track(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routes.track(user.id, id);
  }

  // Watch-time beacon: the player reports actual seconds watched so we can
  // attribute a (currently zero) revenue share and measure route engagement.
  @Post(':id/watch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  watch(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WatchDto) {
    return this.revshare.recordWatch(user.id, id, dto.secondsWatched, dto.source ?? 'playback');
  }
}
