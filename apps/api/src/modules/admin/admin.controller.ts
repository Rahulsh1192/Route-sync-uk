import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

class ModerateDto {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @IsOptional() @IsString() reason?: string;
}
class UpdateUserDto {
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() isSuspended?: boolean;
}
class VerifyInstructorDto {
  @IsIn(['verified', 'rejected']) decision!: 'verified' | 'rejected';
  @IsOptional() @IsString() notes?: string;
}
class AllocateFundDto {
  @IsInt() @Min(1) amountMinor!: number;
  @IsString() period!: string;
  @IsOptional() @IsString() description?: string;
}
class BeneficiaryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() userId?: string;
}
class PayoutDto {
  @IsString() beneficiaryId!: string;
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsString() description?: string;
}
class RunContributionDto {
  @IsOptional() @IsString() period?: string;
}
class RunRevshareDto {
  @IsOptional() @IsString() period?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin') // class default; sensitive methods tighten to admin below
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // --- review & moderation ---
  @Get('review-queue')
  reviewQueue() {
    return this.admin.reviewQueue();
  }

  @Get('routes/:id')
  routeDetail(@Param('id') id: string) {
    return this.admin.routeDetail(id);
  }

  @Post('routes/:id/moderate')
  moderate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ModerateDto) {
    return this.admin.moderate(user.id, id, dto.decision, dto.reason);
  }

  // --- analytics & revenue ---
  @Get('analytics')
  analytics() {
    return this.admin.analytics();
  }

  @Get('revenue')
  @Roles('admin')
  revenue() {
    return this.admin.revenue();
  }

  // --- user management ---
  @Get('users')
  users(@Query('q') q?: string) {
    return this.admin.users(q);
  }

  @Patch('users/:id')
  @Roles('admin')
  updateUser(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.admin.updateUser(user.id, id, dto);
  }

  // --- instructor verification ---
  @Get('instructors')
  pendingInstructors() {
    return this.admin.pendingInstructors();
  }

  /**
   * Signed link to an applicant's uploaded badge photo, valid for a few minutes.
   *
   * Fetched on demand instead of being embedded in the pending-applications list: the list
   * is a page a moderator may leave open, and a URL that grants access to someone's identity
   * document should not outlive the moment it is looked at.
   */
  @Get('instructors/:id/evidence')
  instructorEvidence(@Param('id') id: string) {
    return this.admin.instructorEvidenceUrl(id);
  }

  @Post('instructors/:id/verify')
  verifyInstructor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: VerifyInstructorDto,
  ) {
    return this.admin.verifyInstructor(user.id, id, dto.decision, dto.notes);
  }

  // --- reports & moderation history ---
  @Get('reports')
  reports() {
    return this.admin.reports();
  }

  @Get('moderation-log')
  moderationLog() {
    return this.admin.moderationLog();
  }

  // --- fund ---
  @Get('fund/summary')
  fundSummary() {
    return this.admin.fundSummary();
  }

  @Post('fund/allocate')
  @Roles('admin')
  allocateFund(@CurrentUser() user: AuthUser, @Body() dto: AllocateFundDto) {
    return this.admin.allocateFund(user.id, dto);
  }

  @Get('fund/beneficiaries')
  beneficiaries() {
    return this.admin.listBeneficiaries();
  }

  @Post('fund/beneficiaries')
  @Roles('admin')
  createBeneficiary(@Body() dto: BeneficiaryDto) {
    return this.admin.createBeneficiary(dto.name, dto.description, dto.userId);
  }

  @Post('fund/payout')
  @Roles('admin')
  payout(@CurrentUser() user: AuthUser, @Body() dto: PayoutDto) {
    return this.admin.payout(user.id, dto.beneficiaryId, dto.amountMinor, dto.description);
  }

  @Post('fund/run-contribution')
  @Roles('admin')
  runContribution(@Body() dto: RunContributionDto) {
    return this.admin.runFundContribution(dto.period);
  }

  // --- instructor rev-share (shadow reporting) ---
  @Get('revshare/runs')
  revshareRuns() {
    return this.admin.revshareRuns();
  }

  @Get('revshare/instructors')
  revshareInstructors() {
    return this.admin.revshareInstructors();
  }

  @Get('revshare/runs/:period')
  revshareRunDetail(@Param('period') period: string) {
    return this.admin.revshareRunDetail(period);
  }

  @Post('revshare/run')
  @Roles('admin')
  runRevshare(@Body() dto: RunRevshareDto) {
    return this.admin.runRevshare(dto.period);
  }
}
