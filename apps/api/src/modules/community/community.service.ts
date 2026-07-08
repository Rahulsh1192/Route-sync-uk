import { Injectable, OnModuleInit, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import {
  BADGES,
  CREDITS_PER_ROUTE,
  CURRENT_AGREEMENT_VERSION,
  HIGH_QUALITY_BADGE_AVG,
  HIGH_QUALITY_BADGE_MIN_ROUTES,
  HIGH_QUALITY_BONUS,
  HIGH_QUALITY_THRESHOLD,
} from './community.constants';

/**
 * Contributor community: profiles, reputation, credits, badges, leaderboards,
 * footage-licensing agreement, and instructor-verification submission.
 *
 * Tables (contributors, badges, contributor_badges, leaderboards,
 * contributor_agreements, instructor_verifications) are not in the Prisma client,
 * so they're accessed via raw SQL — db/schema.sql is the source of truth.
 */
@Injectable()
export class CommunityService implements OnModuleInit {
  private readonly logger = new Logger(CommunityService.name);

  constructor(private prisma: PrismaService) {}

  /** Seed the badge catalogue idempotently so contributor_badges FKs resolve. */
  async onModuleInit() {
    for (const b of BADGES) {
      await this.prisma.$executeRaw`
        INSERT INTO badges (id, code, name, description)
        VALUES (gen_random_uuid(), ${b.code}, ${b.name}, ${b.description})
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`;
    }
  }

  // --- profiles ------------------------------------------------------------
  async profile(userId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT u.id, u.display_name, u.avatar_url,
             COALESCE(c.credits, 0) AS credits,
             COALESCE(c.reputation, 0) AS reputation,
             COALESCE(c.routes_published, 0) AS routes_published,
             COALESCE(c.instructor_status, 'none') AS instructor_status,
             c.bio
      FROM users u
      LEFT JOIN contributors c ON c.user_id = u.id
      WHERE u.id = ${userId}::uuid AND u.deleted_at IS NULL`;
    if (!rows[0]) throw new NotFoundException('Contributor not found');

    const badges = await this.prisma.$queryRaw`
      SELECT b.code, b.name, b.description, cb.awarded_at
      FROM contributor_badges cb JOIN badges b ON b.id = cb.badge_id
      WHERE cb.user_id = ${userId}::uuid ORDER BY cb.awarded_at`;

    return { ...rows[0], badges };
  }

  badges() {
    return this.prisma.$queryRaw`SELECT code, name, description FROM badges ORDER BY code`;
  }

  // --- footage-licensing agreement ----------------------------------------
  async acceptAgreement(userId: string, ip?: string) {
    await this.prisma.$executeRaw`
      INSERT INTO contributor_agreements (id, user_id, version, ip)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${CURRENT_AGREEMENT_VERSION}, ${ip ?? null}::inet)
      ON CONFLICT (user_id, version) DO NOTHING`;
    return { version: CURRENT_AGREEMENT_VERSION, accepted: true };
  }

  async hasAcceptedAgreement(userId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT 1 FROM contributor_agreements
      WHERE user_id = ${userId}::uuid AND version = ${CURRENT_AGREEMENT_VERSION} LIMIT 1`;
    return rows.length > 0;
  }

  // --- instructor verification (contributor submission side) ---------------
  async submitInstructorVerification(userId: string, adiNumber: string, evidenceUrl?: string) {
    const existing = await this.prisma.$queryRaw<any[]>`
      SELECT 1 FROM instructor_verifications
      WHERE user_id = ${userId}::uuid AND status = 'pending' LIMIT 1`;
    if (existing.length) throw new ConflictException('A verification request is already pending');

    await this.prisma.$executeRaw`
      INSERT INTO instructor_verifications (id, user_id, adi_number, evidence_url, status)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${adiNumber}, ${evidenceUrl ?? null}, 'pending')`;
    // ensure a contributors row exists and reflects the pending state
    await this.prisma.$executeRaw`
      INSERT INTO contributors (user_id, instructor_status, adi_number)
      VALUES (${userId}::uuid, 'pending', ${adiNumber})
      ON CONFLICT (user_id) DO UPDATE SET instructor_status = 'pending', adi_number = EXCLUDED.adi_number`;
    return { status: 'pending' };
  }

  async instructorStatus(userId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT instructor_status, adi_number, verified_at FROM contributors
      WHERE user_id = ${userId}::uuid`;
    return rows[0] ?? { instructor_status: 'none' };
  }

  // --- credits / reputation / badges (called when a route is published) ----
  async onRoutePublished(contributorId: string) {
    // recompute publish count + average quality from the source of truth
    const stats = await this.prisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS published,
             COALESCE(ROUND(AVG(quality_score)), 0)::int AS avg_quality,
             COALESCE(MAX(quality_score), 0)::int AS last_quality
      FROM routes
      WHERE contributor_id = ${contributorId}::uuid AND status = 'published' AND deleted_at IS NULL`;
    const published: number = stats[0]?.published ?? 0;
    const avgQuality: number = stats[0]?.avg_quality ?? 0;
    const lastQuality: number = stats[0]?.last_quality ?? 0;

    const creditsEarned =
      CREDITS_PER_ROUTE + (lastQuality >= HIGH_QUALITY_THRESHOLD ? HIGH_QUALITY_BONUS : 0);
    // reputation: weight publishing volume + average quality + instructor bonus
    const instructorBonus = await this.isVerifiedInstructor(contributorId) ? 20 : 0;
    const reputation = published * 5 + avgQuality + instructorBonus;

    await this.prisma.$executeRaw`
      INSERT INTO contributors (user_id, credits, reputation, routes_published)
      VALUES (${contributorId}::uuid, ${creditsEarned}, ${reputation}, ${published})
      ON CONFLICT (user_id) DO UPDATE
      SET credits = contributors.credits + ${creditsEarned},
          reputation = ${reputation},
          routes_published = ${published}`;

    await this.evaluateBadges(contributorId, published, avgQuality);
    this.logger.log(`Contributor ${contributorId}: ${published} routes, reputation ${reputation}`);
  }

  /** Award the instructor badge + reputation boost when admin verifies. */
  async onInstructorVerified(userId: string) {
    await this.awardBadge(userId, 'instructor');
    await this.prisma.$executeRaw`
      UPDATE contributors SET reputation = reputation + 20 WHERE user_id = ${userId}::uuid`;
  }

  private async isVerifiedInstructor(userId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT 1 FROM contributors WHERE user_id = ${userId}::uuid AND instructor_status = 'verified' LIMIT 1`;
    return rows.length > 0;
  }

  private async evaluateBadges(userId: string, published: number, avgQuality: number) {
    if (published >= 1) await this.awardBadge(userId, 'first_route');
    if (published >= 10) await this.awardBadge(userId, 'ten_routes');
    if (published >= 50) await this.awardBadge(userId, 'fifty_routes');
    if (published >= HIGH_QUALITY_BADGE_MIN_ROUTES && avgQuality >= HIGH_QUALITY_BADGE_AVG) {
      await this.awardBadge(userId, 'high_quality');
    }
  }

  private async awardBadge(userId: string, code: string) {
    await this.prisma.$executeRaw`
      INSERT INTO contributor_badges (user_id, badge_id, awarded_at)
      SELECT ${userId}::uuid, b.id, now() FROM badges b WHERE b.code = ${code}
      ON CONFLICT (user_id, badge_id) DO NOTHING`;
  }

  // --- leaderboards --------------------------------------------------------
  async leaderboard(period: string) {
    return this.prisma.$queryRaw`
      SELECT l.rank, l.score, u.id AS user_id, u.display_name, u.avatar_url
      FROM leaderboards l JOIN users u ON u.id = l.user_id
      WHERE l.period = ${period} ORDER BY l.rank LIMIT 100`;
  }

  /** Materialise the all-time + current-month leaderboards. Runs nightly. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async rebuildLeaderboards() {
    const month = `monthly:${new Date().toISOString().slice(0, 7)}`;
    for (const period of ['alltime', month]) {
      await this.prisma.$executeRaw`DELETE FROM leaderboards WHERE period = ${period}`;
      await this.prisma.$executeRaw`
        INSERT INTO leaderboards (id, period, user_id, rank, score, computed_at)
        SELECT gen_random_uuid(), ${period}, user_id,
               ROW_NUMBER() OVER (ORDER BY reputation DESC, credits DESC),
               reputation, now()
        FROM contributors WHERE reputation > 0`;
    }
    this.logger.log('Leaderboards rebuilt');
    return { rebuilt: ['alltime', month] };
  }
}
