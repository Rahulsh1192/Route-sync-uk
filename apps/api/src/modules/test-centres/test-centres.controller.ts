import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TestCentresService } from './test-centres.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class CreateTestCentreDto {
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsString() @MinLength(2) @MaxLength(12) postcode!: string;
  // Required: learners search and filter by town, and a centre without one is invisible to
  // them. The create form pre-fills it from the postcode, so this costs the admin nothing.
  @IsString() @MinLength(2) @MaxLength(120) town!: string;
  @IsString() @MinLength(2) @MaxLength(120) region!: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

class UpdateTestCentreDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(12) postcode?: string;
  @IsOptional() @IsString() @MaxLength(120) town?: string;
  @IsOptional() @IsString() @MaxLength(120) region?: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

@ApiTags('test-centres')
@Controller('test-centres')
export class TestCentresController {
  constructor(private readonly service: TestCentresService) {}

  // --- public reads ---
  @Get()
  list(@Query('q') q?: string) {
    return this.service.list(q);
  }

  /**
   * Resolve a postcode to town / region / coordinates so the create form can fill itself
   * in and validate before submit.
   *
   * Declared before `:id` — Nest matches routes in declaration order, and `lookup` would
   * otherwise be swallowed by the `:id` parameter and fail as a bad UUID.
   */
  @Get('lookup/postcode')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('instructor', 'admin')
  @ApiBearerAuth()
  lookupPostcode(@Query('postcode') postcode: string) {
    return this.service.lookupPostcode(postcode ?? '');
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  // --- admin / instructor writes ---
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('instructor', 'admin')
  @ApiBearerAuth()
  create(@Body() dto: CreateTestCentreDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('instructor', 'admin')
  @ApiBearerAuth()
  update(@Param('id') id: string, @Body() dto: UpdateTestCentreDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('instructor', 'admin')
  @ApiBearerAuth()
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
