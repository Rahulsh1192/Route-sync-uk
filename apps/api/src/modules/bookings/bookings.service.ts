import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  UpdateInstructorProfileDto,
  AddAvailabilitySlotDto,
  CreateBookingDto,
  UpdateBookingDto,
} from './dto/bookings.dto';

const PLATFORM_FEE_PCT_DEFAULT = 10;

@Injectable()
export class BookingsService {
  constructor(private prisma: PrismaService) {}

  // ── Instructor profile ────────────────────────────────────────────────────

  async getInstructorProfile(userId: string) {
    const profile = await this.prisma.$queryRaw<any[]>`
      SELECT c.user_id, c.bio AS contributor_bio, c.reputation, c.routes_published,
             c.adi_number, c.verified_at,
             ip.bio, ip.years_experience, ip.lesson_price_minor, ip.currency,
             ip.is_accepting_bookings, ip.stripe_onboarded
      FROM contributors c
      LEFT JOIN instructor_profiles ip ON ip.user_id = c.user_id
      WHERE c.user_id = ${userId}::uuid
        AND c.instructor_status = 'verified'
    `;
    if (!profile.length) throw new NotFoundException('Instructor not found');
    return profile[0];
  }

  async updateMyProfile(userId: string, dto: UpdateInstructorProfileDto) {
    const { bio, lessonPriceMinor, yearsExperience, isAcceptingBookings } = dto;
    await this.prisma.$executeRaw`
      INSERT INTO instructor_profiles (user_id, bio, lesson_price_minor, years_experience, is_accepting_bookings)
      VALUES (
        ${userId}::uuid,
        ${bio ?? null},
        ${lessonPriceMinor ?? 3500},
        ${yearsExperience ?? null},
        ${isAcceptingBookings ?? true}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        bio                    = COALESCE(EXCLUDED.bio, instructor_profiles.bio),
        lesson_price_minor     = COALESCE(EXCLUDED.lesson_price_minor, instructor_profiles.lesson_price_minor),
        years_experience       = COALESCE(EXCLUDED.years_experience, instructor_profiles.years_experience),
        is_accepting_bookings  = EXCLUDED.is_accepting_bookings,
        updated_at             = now()
    `;
    return this.getInstructorProfile(userId);
  }

  async searchInstructors(postcode?: string, maxPriceMinor?: number, page = 0) {
    // Simple search: verified instructors accepting bookings, optionally filtered by price.
    // PostGIS radius search can be added once geocoder is wired.
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT u.id, u.display_name, u.avatar_url,
             c.reputation, c.routes_published, c.adi_number,
             ip.bio, ip.lesson_price_minor, ip.currency, ip.years_experience,
             ip.is_accepting_bookings
      FROM users u
      JOIN contributors c ON c.user_id = u.id
      LEFT JOIN instructor_profiles ip ON ip.user_id = u.id
      WHERE u.role = 'instructor'
        AND c.instructor_status = 'verified'
        AND u.is_suspended = FALSE
        AND (ip.is_accepting_bookings IS NULL OR ip.is_accepting_bookings = TRUE)
        AND (${maxPriceMinor ?? null}::int IS NULL OR ip.lesson_price_minor <= ${maxPriceMinor ?? null}::int)
      ORDER BY c.reputation DESC, ip.lesson_price_minor ASC
      LIMIT 20 OFFSET ${page * 20}
    `;
    return rows;
  }

  // ── Availability ──────────────────────────────────────────────────────────

  async addSlot(userId: string, dto: AddAvailabilitySlotDto) {
    const existing = await this.prisma.$queryRaw<any[]>`
      SELECT id FROM availability_slots
      WHERE instructor_id = ${userId}::uuid
        AND slot_date = ${dto.slotDate}::date
        AND start_time = ${dto.startTime}::time
    `;
    if (existing.length) throw new ConflictException('Slot already exists');

    await this.prisma.$executeRaw`
      INSERT INTO availability_slots (id, instructor_id, slot_date, start_time, end_time)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${dto.slotDate}::date,
              ${dto.startTime}::time, ${dto.endTime}::time)
    `;
    return { ok: true };
  }

  async deleteSlot(userId: string, slotId: string) {
    const slot = await this.prisma.$queryRaw<any[]>`
      SELECT id, is_booked FROM availability_slots
      WHERE id = ${slotId}::uuid AND instructor_id = ${userId}::uuid
    `;
    if (!slot.length) throw new NotFoundException('Slot not found');
    if (slot[0].is_booked) throw new ForbiddenException('Cannot delete a booked slot');
    await this.prisma.$executeRaw`DELETE FROM availability_slots WHERE id = ${slotId}::uuid`;
    return { ok: true };
  }

  async getMySlots(userId: string, fromDate?: string) {
    const from = fromDate ?? new Date().toISOString().slice(0, 10);
    return this.prisma.$queryRaw`
      SELECT * FROM availability_slots
      WHERE instructor_id = ${userId}::uuid
        AND slot_date >= ${from}::date
      ORDER BY slot_date, start_time
    `;
  }

  async getInstructorSlots(instructorId: string) {
    const today = new Date().toISOString().slice(0, 10);
    return this.prisma.$queryRaw`
      SELECT * FROM availability_slots
      WHERE instructor_id = ${instructorId}::uuid
        AND slot_date >= ${today}::date
        AND is_booked = FALSE
      ORDER BY slot_date, start_time
    `;
  }

  // ── Bookings ──────────────────────────────────────────────────────────────

  async createBooking(learnerId: string, dto: CreateBookingDto) {
    // Lock and verify slot
    const slots = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM availability_slots
      WHERE id = ${dto.slotId}::uuid
        AND instructor_id = ${dto.instructorId}::uuid
        AND is_booked = FALSE
      FOR UPDATE
    `;
    if (!slots.length) throw new BadRequestException('Slot not available');

    // Get instructor price + platform fee
    const profile = await this.prisma.$queryRaw<any[]>`
      SELECT COALESCE(ip.lesson_price_minor, 3500) AS lesson_price_minor
      FROM users u
      LEFT JOIN instructor_profiles ip ON ip.user_id = u.id
      WHERE u.id = ${dto.instructorId}::uuid
    `;
    const lessonFee: number = profile[0]?.lesson_price_minor ?? 3500;

    const feePctRow = await this.prisma.$queryRaw<any[]>`
      SELECT value FROM platform_config WHERE key = 'booking_fee_pct'
    `;
    const feePct = parseFloat(feePctRow[0]?.value ?? String(PLATFORM_FEE_PCT_DEFAULT));
    const platformFee = Math.round(lessonFee * feePct / 100);
    const totalAmount = lessonFee + platformFee;

    const bookingId = await this.prisma.$queryRaw<any[]>`
      WITH b AS (
        INSERT INTO bookings (id, learner_id, instructor_id, slot_id, lesson_notes)
        VALUES (gen_random_uuid(), ${learnerId}::uuid, ${dto.instructorId}::uuid,
                ${dto.slotId}::uuid, ${dto.lessonNotes ?? null})
        RETURNING id
      )
      INSERT INTO booking_payments (id, booking_id, amount_minor, lesson_fee_minor,
                                    platform_fee_minor, status)
      SELECT gen_random_uuid(), b.id, ${totalAmount}, ${lessonFee}, ${platformFee}, 'pending'
      FROM b
      RETURNING booking_id
    `;

    await this.prisma.$executeRaw`
      UPDATE availability_slots SET is_booked = TRUE WHERE id = ${dto.slotId}::uuid
    `;

    return { bookingId: bookingId[0].booking_id, totalAmount, lessonFee, platformFee };
  }

  async getMyBookings(learnerId: string) {
    return this.prisma.$queryRaw`
      SELECT b.*, s.slot_date, s.start_time, s.end_time,
             u.display_name AS instructor_name, u.avatar_url AS instructor_avatar,
             p.amount_minor, p.status AS payment_status
      FROM bookings b
      JOIN availability_slots s ON s.id = b.slot_id
      JOIN users u ON u.id = b.instructor_id
      LEFT JOIN booking_payments p ON p.booking_id = b.id
      WHERE b.learner_id = ${learnerId}::uuid
      ORDER BY s.slot_date DESC
    `;
  }

  async getInstructorBookings(instructorId: string) {
    return this.prisma.$queryRaw`
      SELECT b.*, s.slot_date, s.start_time, s.end_time,
             u.display_name AS learner_name, u.avatar_url AS learner_avatar,
             p.amount_minor, p.lesson_fee_minor, p.platform_fee_minor, p.status AS payment_status
      FROM bookings b
      JOIN availability_slots s ON s.id = b.slot_id
      JOIN users u ON u.id = b.learner_id
      LEFT JOIN booking_payments p ON p.booking_id = b.id
      WHERE b.instructor_id = ${instructorId}::uuid
      ORDER BY s.slot_date DESC
    `;
  }

  async updateBooking(actorId: string, actorRole: string, bookingId: string, dto: UpdateBookingDto) {
    const booking = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM bookings WHERE id = ${bookingId}::uuid
    `;
    if (!booking.length) throw new NotFoundException('Booking not found');

    const b = booking[0];
    const isInstructor = b.instructor_id === actorId;
    const isLearner = b.learner_id === actorId;
    const isAdmin = actorRole === 'admin' || actorRole === 'moderator';

    if (!isInstructor && !isLearner && !isAdmin) {
      throw new ForbiddenException('Not authorised to update this booking');
    }

    await this.prisma.$executeRaw`
      UPDATE bookings SET
        status        = ${dto.status},
        cancel_reason = ${dto.cancelReason ?? null},
        updated_at    = now()
      WHERE id = ${bookingId}::uuid
    `;

    // Free the slot if cancelled
    if (dto.status === 'cancelled') {
      await this.prisma.$executeRaw`
        UPDATE availability_slots SET is_booked = FALSE WHERE id = ${b.slot_id}::uuid
      `;
    }
    return { ok: true };
  }

  async adminGetAllBookings(page = 0) {
    return this.prisma.$queryRaw`
      SELECT b.*, s.slot_date, s.start_time,
             ul.display_name AS learner_name, ui.display_name AS instructor_name,
             p.amount_minor, p.platform_fee_minor, p.status AS payment_status
      FROM bookings b
      JOIN availability_slots s ON s.id = b.slot_id
      JOIN users ul ON ul.id = b.learner_id
      JOIN users ui ON ui.id = b.instructor_id
      LEFT JOIN booking_payments p ON p.booking_id = b.id
      ORDER BY s.slot_date DESC
      LIMIT 50 OFFSET ${page * 50}
    `;
  }
}
