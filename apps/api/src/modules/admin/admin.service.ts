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
    const [users, publishedRoutes, premium, pendingReview] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.route.count({ where: { status: RouteStatus.published } }),
      this.prisma.subscription.count({
        where: { plan: { in: ['premium_monthly', 'premium_yearly'] }, status: 'active' },
      }),
      this.prisma.route.count({ where: { status: { in: ['in_review', 'flagged'] } } }),
    ]);
    return { users, publishedRoutes, premiumSubscribers: premium, pendingReview };
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
  users(q?: string) {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(q ? { OR: [{ email: { contains: q } }, { displayName: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, email: true, displayName: true, role: true, isSuspended: true, createdAt: true,
      },
    });
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
      SELECT iv.id, iv.user_id, iv.adi_number, iv.evidence_url, iv.status, iv.created_at,
             u.display_name, u.email
      FROM instructor_verifications iv
      JOIN users u ON u.id = iv.user_id
      WHERE iv.status = 'pending'
      ORDER BY iv.created_at ASC`;
  }

  async verifyInstructor(actorId: string, verificationId: string,
                         decision: 'verified' | 'rejected', notes?: string) {
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT user_id FROM instructor_verifications WHERE id = ${verificationId}::uuid`;
    if (!rows[0]) throw new NotFoundException('Verification not found');
    const userId = rows[0].user_id;

    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        UPDATE instructor_verifications
        SET status = ${decision}::instructor_status, reviewed_by = ${actorId}::uuid,
            review_notes = ${notes ?? null}, reviewed_at = now()
        WHERE id = ${verificationId}::uuid`,
      this.prisma.$executeRaw`
        INSERT INTO contributors (user_id, instructor_status, verified_at)
        VALUES (${userId}::uuid, ${decision}::instructor_status,
                CASE WHEN ${decision} = 'verified' THEN now() ELSE NULL END)
        ON CONFLICT (user_id) DO UPDATE
        SET instructor_status = EXCLUDED.instructor_status,
            verified_at = CASE WHEN ${decision} = 'verified' THEN now() ELSE NULL END`,
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
