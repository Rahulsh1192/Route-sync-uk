import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { JourneysService, VideoSource } from './journeys.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WorkerSecretGuard } from '../../common/guards/worker-secret.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

const VIDEO_SOURCES = ['phone', 'dashcam', 'dual'] as const;

class LatLngDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

class GpsFixDto extends LatLngDto {
  @IsNumber() @Min(0) tMs!: number;
  @IsOptional() @IsNumber() accuracyM?: number;
  @IsOptional() @IsNumber() speedMps?: number;
}

class CreateReferenceRouteDto {
  @IsOptional() @IsUUID() testCentreId?: string;
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(160) startLabel?: string;
  @IsOptional() @IsString() @MaxLength(160) endLabel?: string;
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => LatLngDto)
  points!: LatLngDto[];
}

class StartJourneyDto {
  @IsUUID() referenceRouteId!: string;
  @IsOptional() @IsIn(VIDEO_SOURCES) videoSource?: VideoSource;
}

class LiveCheckDto extends LatLngDto {
  @IsOptional() @IsNumber() @Min(0) lastArcM?: number;
}

class SubmitJourneyDto {
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => GpsFixDto)
  fixes!: GpsFixDto[];
  @IsOptional() @IsIn(VIDEO_SOURCES) videoSource?: VideoSource;
}

/**
 * Phase 24 internal: `fixes` is optional here (unlike the in-app submit) because
 * UC2 uploads have no track to send — it is already stored against the journey the
 * footage is being attached to.
 */
class AnalyseUploadDto {
  @IsUUID() uploadId!: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => GpsFixDto)
  fixes?: GpsFixDto[];
  @IsOptional() @IsIn(VIDEO_SOURCES) videoSource?: VideoSource;
}

@ApiTags('journeys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}

  // ---- reference routes (R1) ----
  @Post('reference-routes')
  @UseGuards(RolesGuard)
  @Roles('instructor', 'admin')
  createReferenceRoute(@CurrentUser() user: AuthUser, @Body() dto: CreateReferenceRouteDto) {
    return this.journeys.createReferenceRoute(user.id, dto);
  }

  @Get('reference-routes')
  listReferenceRoutes(@Query('testCentreId') testCentreId?: string) {
    return this.journeys.listReferenceRoutes(testCentreId);
  }

  @Get('reference-routes/:id')
  getReferenceRoute(@Param('id') id: string) {
    return this.journeys.getReferenceRoute(id);
  }

  // ---- journeys ----
  @Post('journeys')
  @UseGuards(RolesGuard)
  @Roles('instructor', 'admin')
  startJourney(@CurrentUser() user: AuthUser, @Body() dto: StartJourneyDto) {
    return this.journeys.startJourney(user.id, dto.referenceRouteId, dto.videoSource ?? 'phone');
  }

  @Post('journeys/:id/check')
  @UseGuards(RolesGuard)
  @Roles('instructor', 'admin')
  liveCheck(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: LiveCheckDto) {
    return this.journeys.liveCheck(user.id, id, { lat: dto.lat, lng: dto.lng }, dto.lastArcM ?? 0);
  }

  @Post('journeys/:id/submit')
  @UseGuards(RolesGuard)
  @Roles('instructor', 'admin')
  submitJourney(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubmitJourneyDto) {
    return this.journeys.submitJourney(user.id, id, dto.fixes, dto.videoSource);
  }

  @Get('journeys/:id')
  getJourney(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.journeys.getJourney(user.id, user.role, id);
  }

  /**
   * Phase 24: the instructor's own recorded journeys. The upload wizard calls this
   * to offer the drives that dashcam footage can be attached to (UC2).
   */
  @Get('instructors/me/journeys')
  @UseGuards(RolesGuard)
  @Roles('instructor', 'admin')
  listMyJourneys(@CurrentUser() user: AuthUser) {
    return this.journeys.listInstructorJourneys(user.id);
  }
}

/**
 * Internal service-to-service surface for the media worker (Phase 24).
 *
 * Separate from `JourneysController` because that class requires a user JWT and
 * the worker has no session — it authenticates with the shared worker secret
 * instead. Keeping them apart means the internal route can never accidentally
 * inherit (or bypass) the learner-facing auth chain.
 */
@ApiTags('internal')
@UseGuards(WorkerSecretGuard)
@Controller('internal/journeys')
export class InternalJourneysController {
  constructor(private readonly journeys: JourneysService) {}

  /**
   * Run R1 conformance for an upload's merged GPS track and return the verdict,
   * the kept on-route spans and the snapped timeline. The worker posts the track it
   * assembled from the dashcam's GPS logs (UC1), or posts nothing and lets the
   * service read the app-recorded track back out of the journey (UC2).
   */
  @Post('analyse-upload')
  analyseUpload(@Body() dto: AnalyseUploadDto) {
    return this.journeys.analyseUploadTrack(dto.uploadId, dto.fixes, dto.videoSource);
  }
}
