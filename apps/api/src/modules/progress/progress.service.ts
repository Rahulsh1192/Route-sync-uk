import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ProgressService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('ai-summaries') private summaryQueue: Queue,
  ) {}

  /** Called when a learner starts/continues watching. Records the event and
   *  upserts the per-user-route history row. */
  async recordWatch(userId: string, routeId: string, watchPct: number) {
    await this.prisma.$executeRaw`
      INSERT INTO user_route_history
        (id, user_id, route_id, watch_count, watch_pct_max, last_watched_at)
      VALUES
        (gen_random_uuid(), ${userId}::uuid, ${routeId}::uuid, 1, ${watchPct}, now())
      ON CONFLICT (user_id, route_id) DO UPDATE SET
        watch_count   = user_route_history.watch_count + 1,
        watch_pct_max = GREATEST(user_route_history.watch_pct_max, ${watchPct}),
        last_watched_at = now(),
        updated_at = now()
    `;
    await this.upsertProgress(userId);
  }

  /** Called when a learner completes a practice session. */
  async recordPractice(userId: string, routeId: string) {
    await this.prisma.$executeRaw`
      INSERT INTO user_route_history
        (id, user_id, route_id, practice_count, last_practised_at)
      VALUES
        (gen_random_uuid(), ${userId}::uuid, ${routeId}::uuid, 1, now())
      ON CONFLICT (user_id, route_id) DO UPDATE SET
        practice_count    = user_route_history.practice_count + 1,
        last_practised_at = now(),
        updated_at        = now()
    `;
    await this.upsertProgress(userId);
    // Enqueue AI summary generation asynchronously
    await this.summaryQueue.add('generate', { userId, routeId, sessionType: 'practice' });
  }

  /** Called from session-complete endpoint. Enqueues AI summary for watch sessions. */
  async onSessionComplete(userId: string, routeId: string, sessionType: 'watch' | 'practice') {
    if (sessionType === 'watch') {
      await this.summaryQueue.add('generate', { userId, routeId, sessionType });
    }
    return { queued: true };
  }

  async getProgress(userId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM user_progress WHERE user_id = ${userId}::uuid
    `;
    return rows[0] ?? {
      user_id: userId,
      total_routes_watched: 0,
      total_practice_runs: 0,
      total_watch_time_s: 0,
      current_streak_days: 0,
      longest_streak_days: 0,
    };
  }

  async getHistory(userId: string) {
    return this.prisma.$queryRaw<any[]>`
      SELECT urh.*, r.title, r.town, r.difficulty
      FROM user_route_history urh
      JOIN routes r ON r.id = urh.route_id
      WHERE urh.user_id = ${userId}::uuid
      ORDER BY urh.last_watched_at DESC NULLS LAST
      LIMIT 50
    `;
  }

  async getSummary(userId: string, routeId: string, sessionType: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM ai_summaries
      WHERE user_id = ${userId}::uuid
        AND route_id = ${routeId}::uuid
        AND session_type = ${sessionType}::ai_session_type
    `;
    return rows[0] ?? null;
  }

  private async upsertProgress(userId: string) {
    await this.prisma.$executeRaw`
      INSERT INTO user_progress (user_id, total_routes_watched, total_practice_runs,
                                  total_watch_time_s, last_active_at)
      SELECT
        ${userId}::uuid,
        SUM(watch_count),
        SUM(practice_count),
        0,
        now()
      FROM user_route_history
      WHERE user_id = ${userId}::uuid
      ON CONFLICT (user_id) DO UPDATE SET
        total_routes_watched = EXCLUDED.total_routes_watched,
        total_practice_runs  = EXCLUDED.total_practice_runs,
        last_active_at       = now(),
        current_streak_days  = CASE
          WHEN user_progress.last_active_at::date = (now() - interval '1 day')::date
            THEN user_progress.current_streak_days + 1
          WHEN user_progress.last_active_at::date = now()::date
            THEN user_progress.current_streak_days
          ELSE 1
        END,
        longest_streak_days  = GREATEST(
          user_progress.longest_streak_days,
          CASE
            WHEN user_progress.last_active_at::date = (now() - interval '1 day')::date
              THEN user_progress.current_streak_days + 1
            ELSE 1
          END
        ),
        updated_at = now()
    `;
  }
}
