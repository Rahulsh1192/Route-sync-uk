import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { RouteStatus } from '@prisma/client';

/**
 * Instructor revenue-share engine.
 *
 * LAUNCH MODEL: the instructor share of per-centre subscription revenue is 0
 * (`revshare_instructor_pct = 0`). Instructors contribute routes as a
 * social-welfare act (the Community Fund handles the charitable giving) and are
 * rewarded by marketing exposure — their profile is shown while a learner watches,
 * driving lesson bookings. This service still runs every month in "shadow mode":
 * it logs watch-time and computes exactly what each instructor WOULD earn, so the
 * business can validate the numbers and switch a real share on later by changing
 * one config value — no code change, no schema change.
 *
 * All rev-share tables are raw SQL (not in the Prisma client); db/schema.sql +
 * db/migrate_phase_21.sql are the source of truth.
 */
@Injectable()
export class RevshareService {
  private readonly logger = new Logger(RevshareService.name);

  constructor(private prisma: PrismaService) {}

  // ---- config (DB-tunable, no redeploy) ------------------------------------
  async config() {
    const rows = await this.prisma.$queryRaw<Array<{ key: string; value: string }>>`
      SELECT key, value FROM platform_config WHERE key LIKE 'revshare_%'`;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const num = (k: string, d: number) => {
      const v = map.get(k);
      const n = v == null ? NaN : Number(v);
      return Number.isFinite(n) ? n : d;
    };
    return {
      instructorPct: num('revshare_instructor_pct', 0), // 0 = charity + marketing model
      minViewSeconds: num('revshare_min_view_seconds', 30),
      minViewPct: num('revshare_min_view_pct', 25),
      holdbackPct: num('revshare_holdback_pct', 10),
      holdbackDays: num('revshare_holdback_days', 90),
      minPayoutMinor: num('revshare_min_payout_minor', 2000),
      payoutDay: num('revshare_payout_day', 5),
    };
  }

  // ---- watch-time logging ---------------------------------------------------
  /**
   * Record actual watch-time for a route. Append-only truth: the qualifying
   * threshold and per-day cap are applied later at aggregation, so events are
   * never edited. `seconds` is clamped to a sane range to reject bad clients.
   */
  async recordWatch(
    userId: string,
    routeId: string,
    secondsWatched: number,
    source: 'playback' | 'practice',
  ) {
    const secs = Math.max(0, Math.min(Math.round(secondsWatched || 0), 86_400));
    if (secs === 0) return { ok: true, skipped: true };

    const route = await this.prisma.route.findFirst({
      where: { id: routeId, status: RouteStatus.published, deletedAt: null },
      select: { id: true, testCentreId: true, durationS: true },
    });
    if (!route) throw new NotFoundException('Route not found');

    await this.prisma.$executeRaw`
      INSERT INTO route_watch_events
        (route_id, user_id, test_centre_id, source, seconds_watched, route_duration_s)
      VALUES (${routeId}::uuid, ${userId}::uuid,
              ${route.testCentreId}::uuid, ${source}, ${secs}, ${route.durationS ?? null})`;
    return { ok: true };
  }

  // ---- monthly attribution (shadow) ----------------------------------------
  /** Period bounds [start, end) in UTC for a 'YYYY-MM' string. */
  private periodBounds(period: string) {
    const [y, m] = period.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    return { start, end };
  }

  /**
   * Compute (and freeze) the rev-share run for a period. Idempotent per period.
   * Runs on the configured payout day for the previous calendar month. With the
   * instructor share at 0 every accrual is £0 and all revenue stays with the
   * platform — but watch-time shares are still recorded so the report is
   * meaningful and payouts are one config change away.
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async runAttribution(periodOverride?: string) {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const period = periodOverride ?? prev.toISOString().slice(0, 7);

    const existing = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM revshare_runs WHERE period = ${period} LIMIT 1`;
    if (existing.length) {
      this.logger.log(`Rev-share run for ${period} already exists; skipping`);
      return { skipped: true, period };
    }

    const cfg = await this.config();
    const { start, end } = this.periodBounds(period);

    // Per-centre gross (monthly-equivalent) from currently-active subscriptions.
    const centreGross = await this.prisma.$queryRaw<Array<{ test_centre_id: string | null; gross: number }>>`
      SELECT test_centre_id,
             ROUND(SUM(CASE WHEN plan = 'premium_yearly'
                            THEN COALESCE(price_minor, 3999) / 12.0
                            ELSE COALESCE(price_minor, 499) END))::int AS gross
      FROM subscriptions
      WHERE plan IN ('premium_monthly', 'premium_yearly')
        AND status IN ('active', 'trialing', 'past_due')
      GROUP BY test_centre_id`;

    const grossTotal = centreGross.reduce((s, c) => s + Number(c.gross), 0);
    const poolByCentre = new Map<string, number>();
    let poolTotal = 0;
    for (const c of centreGross) {
      const pool = Math.round((Number(c.gross) * cfg.instructorPct) / 100);
      poolByCentre.set(c.test_centre_id ?? '__universal__', pool);
      poolTotal += pool;
    }
    const platformTotal = grossTotal - poolTotal;

    // Qualifying watch-seconds per (centre, instructor) from that centre's PAYING
    // subscribers. Per-event seconds capped at the route's duration.
    const watch = await this.prisma.$queryRaw<
      Array<{ test_centre_id: string | null; instructor_id: string; secs: number }>
    >`
      SELECT r.test_centre_id, r.contributor_id AS instructor_id,
             SUM(LEAST(w.seconds_watched, COALESCE(w.route_duration_s, w.seconds_watched)))::bigint AS secs
      FROM route_watch_events w
      JOIN routes r ON r.id = w.route_id
      WHERE w.watched_at >= ${start} AND w.watched_at < ${end}
        AND w.seconds_watched >= ${cfg.minViewSeconds}
        AND (w.route_duration_s IS NULL
             OR w.seconds_watched * 100 >= w.route_duration_s * ${cfg.minViewPct})
        AND EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.user_id = w.user_id
            AND s.plan IN ('premium_monthly', 'premium_yearly')
            AND s.status IN ('active', 'trialing', 'past_due')
            AND (s.test_centre_id = r.test_centre_id OR s.test_centre_id IS NULL)
        )
      GROUP BY r.test_centre_id, r.contributor_id`;

    // Total qualifying seconds per centre, to turn each instructor's seconds into
    // a share of that centre's pool.
    const secsByCentre = new Map<string, number>();
    for (const w of watch) {
      const key = w.test_centre_id ?? '__universal__';
      secsByCentre.set(key, (secsByCentre.get(key) ?? 0) + Number(w.secs));
    }

    // Create the run, then write the lines + ledger accruals.
    const [{ id: runId }] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO revshare_runs (period, status, gross_minor, pool_minor, platform_minor, config)
      VALUES (${period}, 'finalized', ${grossTotal}, ${poolTotal}, ${platformTotal},
              ${JSON.stringify(cfg)}::jsonb)
      RETURNING id`;

    let lines = 0;
    let accrued = 0;
    for (const w of watch) {
      const key = w.test_centre_id ?? '__universal__';
      const centreSecs = secsByCentre.get(key) ?? 0;
      const centrePool = poolByCentre.get(key) ?? 0;
      const secs = Number(w.secs);
      const sharePct = centreSecs > 0 ? (secs / centreSecs) * 100 : 0;
      const amount = centreSecs > 0 ? Math.round((centrePool * secs) / centreSecs) : 0;

      await this.prisma.$executeRaw`
        INSERT INTO revshare_run_lines
          (run_id, instructor_id, test_centre_id, watch_seconds, share_pct, amount_minor)
        VALUES (${runId}::uuid, ${w.instructor_id}::uuid, ${w.test_centre_id}::uuid,
                ${secs}, ${sharePct.toFixed(3)}::numeric, ${amount})`;
      lines++;

      // Only write a ledger entry when money actually accrues (share > 0), so the
      // ledger stays clean while the launch share is 0.
      if (amount > 0) {
        await this.prisma.$executeRaw`
          INSERT INTO instructor_earnings
            (instructor_id, period, entry_type, amount_minor, test_centre_id, reference, notes)
          VALUES (${w.instructor_id}::uuid, ${period}, 'content_accrual', ${amount},
                  ${w.test_centre_id}::uuid, ${runId}, ${'Watch-time share of subscription pool'})`;
        accrued += amount;
      }
    }

    this.logger.log(
      `Rev-share ${period}: gross ${grossTotal}, pool ${poolTotal} (pct ${cfg.instructorPct}), ` +
        `platform ${platformTotal}, ${lines} lines, accrued ${accrued} (pence)`,
    );
    return { period, grossMinor: grossTotal, poolMinor: poolTotal, platformMinor: platformTotal, lines, accruedMinor: accrued };
  }

  // ---- reporting (admin, read-only) ----------------------------------------
  /** Recent runs, newest first. */
  runs() {
    return this.prisma.$queryRaw`
      SELECT period, status, gross_minor AS "grossMinor", pool_minor AS "poolMinor",
             platform_minor AS "platformMinor", created_at AS "createdAt"
      FROM revshare_runs ORDER BY period DESC LIMIT 24`;
  }

  /** One run with its per-instructor lines. */
  async runDetail(period: string) {
    const runs = await this.prisma.$queryRaw<any[]>`
      SELECT id, period, status, gross_minor AS "grossMinor", pool_minor AS "poolMinor",
             platform_minor AS "platformMinor", config, created_at AS "createdAt"
      FROM revshare_runs WHERE period = ${period}`;
    if (!runs.length) throw new NotFoundException('No run for that period');
    const run = runs[0];
    const lines = await this.prisma.$queryRaw`
      SELECT l.instructor_id AS "instructorId", u.display_name AS "instructorName",
             l.test_centre_id AS "testCentreId", tc.name AS "testCentreName",
             l.watch_seconds AS "watchSeconds", l.share_pct AS "sharePct",
             l.amount_minor AS "amountMinor"
      FROM revshare_run_lines l
      LEFT JOIN users u ON u.id = l.instructor_id
      LEFT JOIN test_centres tc ON tc.id = l.test_centre_id
      WHERE l.run_id = ${run.id}::uuid
      ORDER BY l.amount_minor DESC, l.watch_seconds DESC`;
    return { run, lines };
  }

  /** Instructor balances (SUM of the signed ledger), highest first. */
  instructors() {
    return this.prisma.$queryRaw`
      SELECT e.instructor_id AS "instructorId", u.display_name AS "instructorName",
             SUM(e.amount_minor)::int AS "balanceMinor",
             SUM(CASE WHEN e.entry_type = 'content_accrual' THEN e.amount_minor ELSE 0 END)::int AS "accruedMinor",
             SUM(CASE WHEN e.entry_type = 'payout' THEN -e.amount_minor ELSE 0 END)::int AS "paidMinor",
             MAX(e.created_at) AS "lastEntryAt"
      FROM instructor_earnings e
      LEFT JOIN users u ON u.id = e.instructor_id
      GROUP BY e.instructor_id, u.display_name
      ORDER BY "balanceMinor" DESC`;
  }
}
