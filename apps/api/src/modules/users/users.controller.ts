import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PHONE_MESSAGE, PHONE_PATTERN } from '../../common/validation/phone';
import { UsersService } from './users.service';

/** As `PHONE_PATTERN`, but an empty string is allowed so a user can clear the field. */
const PHONE_OR_EMPTY = new RegExp(`^$|${PHONE_PATTERN.source}`);
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(2) displayName?: string;
  @IsOptional() @IsString() avatarUrl?: string;
  // Phase 26 contact details. Sending an empty string clears the field — that is the only
  // way a user can remove a number they no longer want us to hold.
  @IsOptional() @IsString() @Matches(PHONE_OR_EMPTY, { message: PHONE_MESSAGE })
  phone?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;
  @IsOptional() @IsString() @Matches(PHONE_OR_EMPTY, { message: PHONE_MESSAGE })
  emergencyContactPhone?: string;
}

class TestDetailsDto {
  @IsUUID() testCentreId!: string;
  // ISO date, e.g. "2026-09-14"
  @IsDateString() testDate!: string;
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  /** Remove the contact details we hold, without touching the rest of the account. */
  @Delete('me/contact')
  clearContact(@CurrentUser() user: AuthUser) {
    return this.users.updateProfile(user.id, {
      phone: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
    });
  }

  // Phase 19b — test details (test centre + test date), required before route use.
  @Get('me/test-details')
  testDetails(@CurrentUser() user: AuthUser) {
    return this.users.getTestDetails(user.id);
  }

  @Post('me/test-details')
  addTestDetails(@CurrentUser() user: AuthUser, @Body() dto: TestDetailsDto) {
    return this.users.addTestDetails(user.id, dto.testCentreId, dto.testDate);
  }

  @Post('me/export')
  export(@CurrentUser() user: AuthUser) {
    return this.users.requestExport(user.id);
  }

  @Delete('me')
  erase(@CurrentUser() user: AuthUser) {
    return this.users.requestErasure(user.id);
  }
}
