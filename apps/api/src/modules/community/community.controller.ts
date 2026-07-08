import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { CommunityService } from './community.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class InstructorSubmitDto {
  @IsString() @MinLength(3) adiNumber!: string;
  @IsOptional() @IsString() evidenceUrl?: string;
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

  @Post('instructors/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  submitInstructor(@CurrentUser() user: AuthUser, @Body() dto: InstructorSubmitDto) {
    return this.community.submitInstructorVerification(user.id, dto.adiNumber, dto.evidenceUrl);
  }

  @Get('instructors/me/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  instructorStatus(@CurrentUser() user: AuthUser) {
    return this.community.instructorStatus(user.id);
  }
}
