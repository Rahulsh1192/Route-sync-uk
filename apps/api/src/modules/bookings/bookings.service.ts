import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PostcodeService } from '../geo/postcode.service';
import {
  UpdateInstructorProfileDto,
  AddAvailabilitySlotDto,
  CreateBookingDto,
  UpdateBookingDto,
} from './dto/bookings.dto';

const PLATFORM_FEE_PCT_DEFAULT = 10;

/**
 * Hard ceiling on what proximity search will call "nearby", regardless of the radius an
 * instructor set for themselves. A driving lesson starts at the learner's door, so an
 * instructor 60km away is not a local option however far they say they will travel.
 */
const MAX_NEARBY_KM = 40;

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private postcodes: PostcodeService,
  ) {}

  // ── Instructor profile ────────────────────────────────────────────────────

  async getInstructorProfile(userId: string) {
    const profile = await this.prisma.$queryRaw<any[]>`
      SELECT c.user_id, c.bio AS contributor_bio, c.reputation, c.routes_published,
             c.adi_number, c.verified_at,
             u.display_name,
             ip.bio, ip.years_experience, ip.lesson_price_minor, ip.currency,
             ip.is_accepting_bookings, ip.stripe_onboarded,
             ip.base_postcode, ip.travel_radius_km
      FROM contributors c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN instructor_profiles ip ON ip.user_id = c.user_id
      WHERE c.user_id = ${userId}::uuid
        AND c.instructor_status = 'verified'
    `;
    if (!profile.length) throw new NotFoundException('Instructor not found');
    return profile[0];
  }

  async updateMyProfile(userId: string, dto: UpdateInstructorProfileDto) {
    const { bio, lessonPriceMinor, yearsExperience, isAcceptingBookings, basePostcode,
            travelRadiusKm } = dto;

    // The base postcode is what makes an instructor findable: proximity search measures
    // from this point, and a profile without one can only ever appear in the "covers other
    // areas" fallback. Geocoded on save rather than on search so a search stays one query.
    let baseLat: number | null = null;
    let baseLng: number | null = null;
    let basePostcodeCanonical: string | null = null;
    if (basePostcode?.trim()) {
      const found = await this.postcodes.require(basePostcode);
      baseLat = found.lat;
      baseLng = found.lng;
      basePostcodeCanonical = found.postcode;
    }

    await this.prisma.$executeRaw`
      INSERT INTO instructor_profiles (user_id, bio, lesson_price_minor, years_experience,
                                       is_accepting_bookings, base_postcode, base_location,
                                       travel_radius_km)
      VALUES (
        ${userId}::uuid,
        ${bio ?? null},
        ${lessonPriceMinor ?? 3500},
        ${yearsExperience ?? null},
        ${isAcceptingBookings ?? true},
        ${basePostcodeCanonical},
        CASE WHEN ${baseLng}::float8 IS NULL THEN NULL
             ELSE ST_SetSRID(ST_MakePoint(${baseLng}::float8, ${baseLat}::float8), 4326)::geography
        END,
        ${travelRadiusKm ?? 16}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        bio                    = COALESCE(EXCLUDED.bio, instructor_profiles.bio),
        lesson_price_minor     = COALESCE(EXCLUDED.lesson_price_minor, instructor_profiles.lesson_price_minor),
        years_experience       = COALESCE(EXCLUDED.years_experience, instructor_profiles.years_experience),
        is_accepting_bookings  = EXCLUDED.is_accepting_bookings,
        -- COALESCE: omitting the postcode from a partial update (changing only the price,
        -- say) must not wipe the location and quietly drop the instructor out of every
        -- local search. Clearing it is a separate, explicit action.
        base_postcode          = COALESCE(EXCLUDED.base_postcode, instructor_profiles.base_postcode),
        base_location          = COALESCE(EXCLUDED.base_location, instructor_profiles.base_location),
        travel_radius_km       = COALESCE(EXCLUDED.travel_radius_km, instructor_profiles.travel_radius_km),
        updated_at             = now()
    `;
    return this.getInstructorProfile(userId);
  }

  /**
   * Find instructors a learner can book, nearest first.
   *
   * The `postcode` argument used to be accepted and then ignored — the query had no
   * location in it at all, so "instructors near me" returned the same nationwide list
   * ordered by reputation whatever you typed. Now the postcode is geocoded and distance is
   * measured against each instructor's base location.
   *
   * Two groups come back, because a learner in an area with no coverage needs an answer
   * rather than an empty page:
   *
   *   `nearby`    — within the distance that instructor said they will travel.
   *   `elsewhere` — the nearest instructors outside that, populated **only when `nearby` is
   *                 empty**. Mixing them into one list would present someone 90km away as
   *                 a local option; keeping them separate lets the UI say "none in your
   *                 area yet, but these instructors cover other areas".
   *
   * Instructors with no base location set can never satisfy a radius test, so they appear
   * in `elsewhere` (ranked last) rather than vanishing from the product entirely.
   */
  async searchInstructors(postcode?: string, maxPriceMinor?: number, page = 0) {
    const pageSize = 20;
    const offset = page * pageSize;

    // No postcode: the plain nationwide list, ordered by standing. Still returned in the
    // same shape so the client has one response format to handle.
    if (!postcode?.trim()) {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT u.id, u.display_name, u.avatar_url,
               c.reputation, c.routes_published, c.adi_number,
               ip.bio, ip.lesson_price_minor, ip.currency, ip.years_experience,
               ip.is_accepting_bookings, ip.base_postcode,
               NULL::float8 AS "distanceKm",
               FALSE AS "isNearby"
        FROM users u
        JOIN contributors c ON c.user_id = u.id
        LEFT JOIN instructor_profiles ip ON ip.user_id = u.id
        WHERE u.role = 'instructor'
          AND c.instructor_status = 'verified'
          AND u.is_suspended = FALSE
          AND (ip.is_accepting_bookings IS NULL OR ip.is_accepting_bookings = TRUE)
          AND (${maxPriceMinor ?? null}::int IS NULL
               OR COALESCE(ip.lesson_price_minor, 3500) <= ${maxPriceMinor ?? null}::int)
        ORDER BY c.reputation DESC, ip.lesson_price_minor ASC NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      return { origin: null, nearby: rows, elsewhere: [] as any[], searchedRadiusKm: null };
    }

    // A proximity search cannot silently degrade into a non-proximity one: the learner
    // would be shown instructors from anywhere as though they were local.
    const origin = await this.postcodes.require(postcode);

    const rows = await this.prisma.$queryRaw<any[]>`
      WITH origin AS (
        SELECT ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography AS geom
      )
      SELECT u.id, u.display_name, u.avatar_url,
             c.reputation, c.routes_published, c.adi_number,
             ip.bio, ip.lesson_price_minor, ip.currency, ip.years_experience,
             ip.is_accepting_bookings, ip.base_postcode,
             ROUND((ST_Distance(ip.base_location, o.geom) / 1000)::numeric, 1)::float8 AS "distanceKm",
             -- The instructor's own stated travel radius decides what counts as reachable,
             -- capped so a profile claiming a 200km radius cannot present itself as local.
             (ip.base_location IS NOT NULL
              AND ST_DWithin(ip.base_location, o.geom,
                             LEAST(COALESCE(ip.travel_radius_km, 16), ${MAX_NEARBY_KM}) * 1000)
             ) AS "isNearby"
      FROM users u
      JOIN contributors c ON c.user_id = u.id
      LEFT JOIN instructor_profiles ip ON ip.user_id = u.id
      CROSS JOIN origin o
      WHERE u.role = 'instructor'
        AND c.instructor_status = 'verified'
        AND u.is_suspended = FALSE
        AND (ip.is_accepting_bookings IS NULL OR ip.is_accepting_bookings = TRUE)
        AND (${maxPriceMinor ?? null}::int IS NULL
             OR COALESCE(ip.lesson_price_minor, 3500) <= ${maxPriceMinor ?? null}::int)
      -- NULLS LAST so an instructor with no base location sorts after every locatable one
      -- instead of leading the results on a NULL distance.
      ORDER BY "isNearby" DESC, "distanceKm" ASC NULLS LAST, c.reputation DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const nearby = rows.filter((r) => r.isNearby);
    return {
      origin: { postcode: origin.postcode, lat: origin.lat, lng: origin.lng,
                town: origin.town, approximate: origin.approximate },
      nearby,
      // Only when there is nothing local — see the note above about not mixing the two.
      elsewhere: nearby.length ? [] : rows.filter((r) => !r.isNearby),
      searchedRadiusKm: MAX_NEARBY_KM,
    };
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
