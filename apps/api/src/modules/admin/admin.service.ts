import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CommunityService } from '../community/community.service';
import { FundService } from '../fund/fund.service';
import { RevshareService } from '../revshare/revshare.service';
import { RouteStatus, UserRole } from '@prisma/client';

/**
 * Admin/moderator business logic. Tables not mapped in the Prisma client
 * (approvals, instructor_verifications, contributors, reports, moderation_actions,
 * fund_transactions, upload_stages) are accessed via raw SQL, consistent with the
 * rest of the admin module. db/schema.sql is the source of truth for those.
 */
@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private community: CommunityService,
    private fund: FundService,
    private revshare: RevshareService,
  ) {}

  // --- review queue & moderation -------------------------------------------
  reviewQueue() {
    return this.prisma.route.findMany({
      where: { status: { in: [RouteStatus.in_review, RouteStatus.flagged] }, deletedAt: null },
      orderBy: [{ isInstructor: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      select: {
        id: true, title: true, status: true, qualityScore: true, syncConfidence: true,
        isInstructor: true, contributorId: true, createdAt: true,
      },
    });
  }

  /** Full route detail for the moderator: pipeline findings, videos, signed thumbnail. */
  async routeDetail(routeId: string) {
    const route = await this.prisma.route.findUnique({ where: { id: routeId } });
    if (!route) throw new NotFoundException('Route not found');

    const stages = await this.prisma.$queryRaw`
      SELECT us.stage, us.state, us.progress, us.findings, us.finished_at
      FROM upload_stages us
      JOIN uploads u ON u.id = us.upload_id
      WHERE u.route_id = ${routeId}::uuid
      ORDER BY us.finished_at NULLS LAST
    `;
    const videos = await this.prisma.$queryRaw`
      SELECT view, rendition, width, height, fps, duration_s, sync_offset_ms
      FROM route_videos WHERE route_id = ${routeId}::uuid
    `;
    const quality = await this.prisma.$queryRaw`
      SELECT gps_quality, video_quality, completeness, sync_confidence, contributor_rep,
             overall, details
      FROM route_quality_scores WHERE route_id = ${routeId}::uuid
    `;
    const preview = await this.prisma.$queryRaw<Array<{ thumbnail_key: string | null }>>`
      SELECT thumbnail_key FROM route_previews WHERE route_id = ${routeId}::uuid
    `;

    let thumbnailUrl: string | null = null;
    const key = preview[0]?.thumbnail_key;
    if (key) thumbnailUrl = await this.storage.presignDownload(key, 600);

    return {
      route,
      stages,
      videos,
      quality: (quality as unknown[])[0] ?? null,
      thumbnailUrl,
    };
  }

  async moderate(actorId: string, routeId: string, decision: 'approve' | 'reject', reason?: string) {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { contributorId: true },
    });
    if (!route) throw new NotFoundException('Route not found');

    const status = decision === 'approve' ? RouteStatus.published : RouteStatus.rejected;
    await this.prisma.$transaction([
      this.prisma.route.update({
        where: { id: routeId },
        data: { status, publishedAt: status === RouteStatus.published ? new Date() : null },
      }),
      this.prisma.$executeRaw`
        INSERT INTO approvals (id, route_id, reviewer_id, decision, reason, decided_at)
        VALUES (gen_random_uuid(), ${routeId}::uuid, ${actorId}::uuid,
                ${decision === 'approve' ? 'approved' : 'rejected'}::approval_decision,
                ${reason ?? null}, now())`,
      this.prisma.$executeRaw`
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after)
        VALUES (${actorId}::uuid, 'route.moderate', 'route', ${routeId}::uuid,
                ${JSON.stringify({ decision, reason })}::jsonb)`,
    ]);

    // On publish: award credits, recompute reputation, evaluate badges.
    if (status === RouteStatus.published) {
      await this.community.onRoutePublished(route.contributorId);
    }
    return { id: routeId, status };
  }

  // --- analytics & revenue -------------------------------------------------
  async analytics() {
    const [users, publishedRoutes, premium, pendingReview, pendingInstructors] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.route.count({ where: { status: RouteStatus.published } }),
      this.prisma.subscription.count({
        where: { plan: { in: ['premium_monthly', 'premium_yearly'] }, status: 'active' },
      }),
      this.prisma.route.count({ where: { status: { in: ['in_review', 'flagged'] } } }),
      // Counted here so the console can badge the Instructors tab. Without it an ADI
      // application was invisible unless a moderator happened to open that panel and look —
      // reported from testing as "the admin never sees the verification request". Raw SQL
      // because instructor_verifications is not in the Prisma schema.
      this.prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(*)::int AS count FROM instructor_verifications WHERE status = 'pending'
      `,
    ]);
    return {
      users,
      publishedRoutes,
      premiumSubscribers: premium,
      pendingReview,
      pendingInstructors: pendingInstructors[0]?.count ?? 0,
    };
  }

  async revenue() {
    const subs = await this.prisma.subscription.groupBy({
      by: ['plan', 'status'],
      _count: { _all: true },
    });
    const monthly = await this.prisma.subscription.count({
      where: { plan: 'premium_monthly', status: 'active' },
    });
    const yearly = await this.prisma.subscription.count({
      where: { plan: 'premium_yearly', status: 'active' },
    });
    // MRR in pence: monthly @ £4.99 + yearly @ £29.99/12
    const mrrMinor = monthly * 499 + Math.round((yearly * 2999) / 12);
    return {
      breakdown: subs,
      activeMonthly: monthly,
      activeYearly: yearly,
      mrrMinor,
      mrrFormatted: `£${(mrrMinor / 100).toFixed(2)}`,
      currency: 'GBP',
    };
  }

  // --- user management -----------------------------------------------------
  /**
   * Admin user search, now including contact details (Phase 26).
   *
   * Raw SQL because the contact columns are not in the generated Prisma client. The phone
   * match strips non-digits from both sides, so a staff member searching `07700900123`
   * finds a number stored as `07700 900123` — an exact-string match on a field people
   * format inconsistently would find almost nothing.
   */
  users(q?: string) {
    const term = q?.trim() || null;
    const digits = term ? term.replace(/\D/g, '') : '';
    return this.prisma.$queryRaw`
      SELECT id, email, display_name AS "displayName", role,
             is_suspended AS "isSuspended", email_verified AS "emailVerified",
             created_at AS "createdAt",
             phone, emergency_contact_name AS "emergencyContactName",
             emergency_contact_phone AS "emergencyContactPhone"
      FROM users
      WHERE deleted_at IS NULL
        AND (${term}::text IS NULL
             OR email ILIKE '%' || ${term ?? ''} || '%'
             OR display_name ILIKE '%' || ${term ?? ''} || '%'
             OR (${digits} <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')
                   LIKE '%' || ${digits} || '%'))
      ORDER BY created_at DESC
      LIMIT 50`;
  }

  async updateUser(actorId: string, userId: string, data: { role?: UserRole; isSuspended?: boolean }) {
    if (data.role === undefined && data.isSuspended === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, role: true, isSuspended: true },
    });
    await this.prisma.$executeRaw`
      INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after)
      VALUES (${actorId}::uuid, 'user.update', 'user', ${userId}::uuid, ${JSON.stringify(data)}::jsonb)`;
    return user;
  }

  // --- instructor verification ---------------------------------------------
  pendingInstructors() {
    return this.prisma.$queryRaw`
      SELECT iv.id, iv.user_id, iv.adi_number, iv.adi_expiry, iv.evidence_url,
             -- Only whether a photo exists; the key itself is not useful to the client,
             -- which has to ask for a signed URL to see it (see evidenceUrl below).
             (iv.evidence_key IS NOT NULL) AS "hasEvidenceFile",
             iv.status, iv.created_at,
             u.display_name, u.email, u.phone,
             -- A moderator should not have to work out whether a badge is still current
             -- from a raw date; submissions predating Phase 26 have no expiry at all,
             -- which is itself worth showing rather than rendering as valid.
             (iv.adi_expiry IS NOT NULL AND iv.adi_expiry < CURRENT_DATE) AS "adiExpired"
      FROM instructor_verifications iv
      JOIN users u ON u.id = iv.user_id
      WHERE iv.status = 'pending'
      ORDER BY iv.created_at ASC`;
  }

  /**
   * Short-lived signed URL for an uploaded badge photo.
   *
   * The bucket is private and badge evidence is an identity document, so it is never served
   * from a public URL. A moderator asks for a link at the moment they want to look, and it
   * expires shortly after — rather than the alternative of a permanent URL sitting in an
   * admin page that anyone with the link could later replay.
   */
  async instructorEvidenceUrl(verificationId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ evidence_key: string | null }>>`
      SELECT evidence_key FROM instructor_verifications WHERE id = ${verificationId}::uuid`;
    if (!rows[0]) throw new NotFoundException('Verification not found');
    if (!rows[0].evidence_key) {
      throw new NotFoundException('This application has no uploaded badge photo');
    }
    return { url: await this.storage.presignDownload(rows[0].evidence_key, 300) };
  }

  async verifyInstructor(actorId: string, verificationId: string,
                         decision: 'verified' | 'rejected', notes?: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ user_id: string; adi_number: string | null; adi_expiry: Date | null }>
    >`
      SELECT user_id, adi_number, adi_expiry
      FROM instructor_verifications WHERE id = ${verificationId}::uuid`;
    if (!rows[0]) throw new NotFoundException('Verification not found');
    const { user_id: userId, adi_number: adiNumber, adi_expiry: adiExpiry } = rows[0];

    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        UPDATE instructor_verifications
        SET status = ${decision}::instructor_status, reviewed_by = ${actorId}::uuid,
            review_notes = ${notes ?? null}, reviewed_at = now()
        WHERE id = ${verificationId}::uuid`,
      // The approved badge and its expiry are copied onto `contributors` so the badge shown
      // next to an instructor can be checked for currency without joining the verification
      // history. COALESCE on update: a rejection must not erase details from an earlier
      // approval that is still valid.
      this.prisma.$executeRaw`
        INSERT INTO contributors (user_id, instructor_status, verified_at, adi_number, adi_expiry)
        VALUES (${userId}::uuid, ${decision}::instructor_status,
                CASE WHEN ${decision} = 'verified' THEN now() ELSE NULL END,
                ${adiNumber}, ${adiExpiry})
        ON CONFLICT (user_id) DO UPDATE
        SET instructor_status = EXCLUDED.instructor_status,
            verified_at = CASE WHEN ${decision} = 'verified' THEN now() ELSE NULL END,
            adi_number  = COALESCE(EXCLUDED.adi_number, contributors.adi_number),
            adi_expiry  = COALESCE(EXCLUDED.adi_expiry, contributors.adi_expiry)`,
    ]);

    if (decision === 'verified') {
      await this.prisma.user.update({ where: { id: userId }, data: { role: UserRole.instructor } });
      await this.community.onInstructorVerified(userId);
    }
    return { id: verificationId, status: decision };
  }

  // --- reports & moderation history ----------------------------------------
  reports() {
    return this.prisma.$queryRaw`
      SELECT id, reporter_id, target_type, target_id, reason, status, created_at
      FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 50`;
  }

  moderationLog() {
    return this.prisma.$queryRaw`
      SELECT actor_id, action, entity_type, entity_id, after, created_at
      FROM audit_log ORDER BY created_at DESC LIMIT 50`;
  }

  // --- fund (delegated to FundService) -------------------------------------
  fundSummary() {
    return this.fund.summary();
  }
  allocateFund(actorId: string, p: { amountMinor: number; period: string; description?: string }) {
    return this.fund.manualAllocation(actorId, p.amountMinor, p.period, p.description);
  }
  listBeneficiaries() {
    return this.fund.listBeneficiaries();
  }
  createBeneficiary(name: string, description?: string, userId?: string) {
    return this.fund.createBeneficiary(name, description, userId);
  }
  payout(actorId: string, beneficiaryId: string, amountMinor: number, description?: string) {
    return this.fund.payout(actorId, beneficiaryId, amountMinor, description);
  }
  runFundContribution(period?: string) {
    return this.fund.runMonthlyContribution(period);
  }

  // --- instructor rev-share (delegated to RevshareService) ------------------
  revshareRuns() {
    return this.revshare.runs();
  }
  revshareRunDetail(period: string) {
    return this.revshare.runDetail(period);
  }
  revshareInstructors() {
    return this.revshare.instructors();
  }
  runRevshare(period?: string) {
    return this.revshare.runAttribution(period);
  }
}
