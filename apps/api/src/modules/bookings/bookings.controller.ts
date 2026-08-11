import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import {
  UpdateInstructorProfileDto,
  AddAvailabilitySlotDto,
  CreateBookingDto,
  UpdateBookingDto,
} from './dto/bookings.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Bookings: instructor discovery, an ADI's own profile and availability, and lessons.
 *
 * Every handler here takes the caller from `@CurrentUser()`, which is typed. It used to read
 * `req.user.sub` off an `@Request() req: any` — and `req.user` is what `JwtStrategy.validate`
 * returns, which is `{ id, role, email }`. There is no `sub` on it (that is the name of the
 * claim *inside* the token, not the property on the user), so every one of these handlers
 * passed `undefined` as the user id.
 *
 * Nothing failed loudly: `undefined` binds as NULL, so `WHERE learner_id = NULL` matched no
 * rows and "My Bookings" was permanently empty, while inserts died on a NOT NULL constraint
 * as a 500. `any` on the request parameter is what let it compile. The typed decorator makes
 * the same mistake a compile error.
 */
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

  // ── ADI: manage own profile ───────────────────────────────────────────────
  //
  // Declared BEFORE the `instructors/:id/...` routes below. Nest matches routes in
  // declaration order, so with `:id/slots` first, a request for `instructors/me/slots` was
  // matched by it with `id = "me"` — which reached the database as `'me'::uuid` and failed
  // with a 500. The instructor's own availability endpoint was unreachable, so an ADI could
  // add slots (that path has no `:id` twin) but never see them.

  @Put('instructors/me/profile')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  updateMyProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateInstructorProfileDto) {
    return this.svc.updateMyProfile(user.id, dto);
  }

  @Get('instructors/me/slots')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  getMySlots(@CurrentUser() user: AuthUser, @Query('from') from?: string) {
    return this.svc.getMySlots(user.id, from);
  }

  @Post('instructors/me/slots')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  addSlot(@CurrentUser() user: AuthUser, @Body() dto: AddAvailabilitySlotDto) {
    return this.svc.addSlot(user.id, dto);
  }

  @Delete('instructors/me/slots/:slotId')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  deleteSlot(@CurrentUser() user: AuthUser, @Param('slotId') slotId: string) {
    return this.svc.deleteSlot(user.id, slotId);
  }

  @Get('instructors/me/bookings')
  @UseGuards(RolesGuard)
  @Roles('instructor')
  getMyInstructorBookings(@CurrentUser() user: AuthUser) {
    return this.svc.getInstructorBookings(user.id);
  }

  // ── A specific instructor (dynamic `:id` — must come after every `me/…` route) ──

  @Get('instructors/:id/profile')
  getInstructorProfile(@Param('id') id: string) {
    return this.svc.getInstructorProfile(id);
  }

  @Get('instructors/:id/slots')
  getInstructorSlots(@Param('id') id: string) {
    return this.svc.getInstructorSlots(id);
  }

  // ── Learner: bookings ────────────────────────────────────────────────────

  @Post('bookings')
  createBooking(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.svc.createBooking(user.id, dto);
  }

  @Get('bookings/mine')
  getMyBookings(@CurrentUser() user: AuthUser) {
    return this.svc.getMyBookings(user.id);
  }

  @Patch('bookings/:id')
  updateBooking(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBookingDto,
  ) {
    return this.svc.updateBooking(user.id, user.role, id, dto);
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
