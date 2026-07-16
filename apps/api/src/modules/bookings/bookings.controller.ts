import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, Request, UseGuards, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import {
  UpdateInstructorProfileDto,
  AddAvailabilitySlotDto,
  CreateBookingDto,
  UpdateBookingDto,
} from './dto/bookings.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private svc: BookingsService) {}

  // ── Instructor discovery ─────────────────────────────────────────────────

  @Get('instructors')
  searchInstructors(
    @Query('postcode') postcode?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) page?: number,
  ) {
    return this.svc.searchInstructors(
      postcode,
      maxPrice ? parseInt(maxPrice) : undefined,
      page,
    );
  }

  @Get('instructors/:id/profile')
  getInstructorProfile(@Param('id') id: string) {
    return this.svc.getInstructorProfile(id);
  }

  @Get('instructors/:id/slots')
  getInstructorSlots(@Param('id') id: string) {
    return this.svc.getInstructorSlots(id);
  }

  // ── ADI: manage own profile ───────────────────────────────────────────────

  @Put('instructors/me/profile')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  updateMyProfile(@Request() req: any, @Body() dto: UpdateInstructorProfileDto) {
    return this.svc.updateMyProfile(req.user.sub, dto);
  }

  @Get('instructors/me/slots')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  getMySlots(@Request() req: any, @Query('from') from?: string) {
    return this.svc.getMySlots(req.user.sub, from);
  }

  @Post('instructors/me/slots')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  addSlot(@Request() req: any, @Body() dto: AddAvailabilitySlotDto) {
    return this.svc.addSlot(req.user.sub, dto);
  }

  @Delete('instructors/me/slots/:slotId')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  deleteSlot(@Request() req: any, @Param('slotId') slotId: string) {
    return this.svc.deleteSlot(req.user.sub, slotId);
  }

  @Get('instructors/me/bookings')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  getMyInstructorBookings(@Request() req: any) {
    return this.svc.getInstructorBookings(req.user.sub);
  }

  // ── Learner: bookings ────────────────────────────────────────────────────

  @Post('bookings')
  createBooking(@Request() req: any, @Body() dto: CreateBookingDto) {
    return this.svc.createBooking(req.user.sub, dto);
  }

  @Get('bookings/mine')
  getMyBookings(@Request() req: any) {
    return this.svc.getMyBookings(req.user.sub);
  }

  @Patch('bookings/:id')
  updateBooking(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateBookingDto,
  ) {
    return this.svc.updateBooking(req.user.sub, req.user.role, id, dto);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  @Get('admin/bookings')
  @UseGuards(RolesGuard)
  @Roles('admin', 'moderator')
  adminGetAllBookings(
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) page: number,
  ) {
    return this.svc.adminGetAllBookings(page);
  }
}
