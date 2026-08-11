import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { CommunityService } from './community.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class InstructorSubmitDto {
  @IsString() @MinLength(3) adiNumber!: string;
  /**
   * ADI badge expiry, `YYYY-MM-DD`. Required: a DVSA certificate lasts four years, so
   * without it a verification can never be re-checked and a lapsed badge reads as valid
   * forever. The service also rejects a date already in the past.
   */
  @IsDateString() adiExpiry!: string;
  @IsOptional() @IsString() evidenceUrl?: string;
  /**
   * Object key of a badge photo uploaded via `POST /instructors/verify/evidence-upload`.
   * Kept alongside `evidenceUrl` rather than replacing it — an applicant who already hosts
   * their certificate somewhere can still link to it.
   */
  @IsOptional() @IsString() @MaxLength(300) evidenceKey?: string;
}

class EvidenceUploadDto {
  /** Validated against an allow-list in the service; a badge photo is an image or a PDF. */
  @IsString() @MaxLength(100) contentType!: string;
  /** Declared size, so an oversized file is refused before it is uploaded, not after. */
  @IsOptional() @IsInt() @Min(1) bytes?: number;
}

@ApiTags('community')
@Controller()
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  // --- public ---
  @Get('badges')
  badges() {
    return this.community.badges();
  }

  @Get('leaderboards')
  leaderboard(@Query('period') period = 'alltime') {
    return this.community.leaderboard(period);
  }

  @Get('contributors/:id')
  profile(@Param('id') id: string) {
    return this.community.profile(id);
  }

  // --- authenticated contributor actions ---
  @Get('contributors/me/profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return this.community.profile(user.id);
  }

  @Post('contributors/agreement')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  acceptAgreement(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.community.acceptAgreement(user.id, req.ip);
  }

  /**
   * Presigned PUT for a photo of the applicant's ADI badge.
   *
   * Declared before `instructors/verify` is irrelevant here (distinct literal paths), but it
   * must stay authenticated: the key it returns is scoped to the calling user's id.
   */
  @Post('instructors/verify/evidence-upload')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  evidenceUpload(@CurrentUser() user: AuthUser, @Body() dto: EvidenceUploadDto) {
    return this.community.createEvidenceUpload(user.id, dto.contentType, dto.bytes);
  }

  @Post('instructors/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  submitInstructor(@CurrentUser() user: AuthUser, @Body() dto: InstructorSubmitDto) {
    return this.community.submitInstructorVerification(
      user.id,
      dto.adiNumber,
      dto.adiExpiry,
      dto.evidenceUrl,
      dto.evidenceKey,
    );
  }

  @Get('instructors/me/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  instructorStatus(@CurrentUser() user: AuthUser) {
    return this.community.instructorStatus(user.id);
  }
}
