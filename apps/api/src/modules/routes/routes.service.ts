import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { RouteStatus } from '@prisma/client';

@Injectable()
export class RoutesService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private subs: SubscriptionsService,
  ) {}

  /**
   * Central access decision for a single route. The Phase 19b test-details gate
   * was retired in Phase 20 — learners browse freely; access is decided purely by
   * Premium + the one-route demo allowance:
   *   - `ok`: Premium for this route's centre, OR this is the account's one claimed
   *     demo route, OR no demo route has been claimed yet (this becomes it).
   *   - `PAYWALL`: needs Premium (the free demo route was already used on another).
   *
   * `commit=true` (real playback/practice) claims the route for a non-Premium user
   * on first access; `commit=false` (the access-check endpoint) is a dry run.
   * Premium is per test centre; the demo allowance is one route total, account-wide.
   */
  private async resolveAccess(
    userId: string,
    route: { id: string; testCentreId: string | null },
    commit: boolean,
  ): Promise<'ok' | 'PAYWALL'> {
    // Premium for this route's centre → unlimited.
    if (await this.subs.isPremiumForCentre(userId, route.testCentreId)) return 'ok';

    // Demo allowance — one route total across the account.
    const claim = await this.prisma.demoRouteClaim.findUnique({ where: { userId } });
    if (claim) return claim.routeId === route.id ? 'ok' : 'PAYWALL';

    // No claim yet: the first route the user opens becomes their free demo route.
    if (commit) {
      try {
        await this.prisma.demoRouteClaim.create({ data: { userId, routeId: route.id } });
      } catch {
        // Lost a race to claim a different route; honour whatever won.
        const c = await this.prisma.demoRouteClaim.findUnique({ where: { userId } });
        return c && c.routeId === route.id ? 'ok' : 'PAYWALL';
      }
    }
    return 'ok';
  }

  /** Turn an access decision into the thrown error playback/practice use. */
  private enforce(decision: 'ok' | 'PAYWALL') {
    if (decision === 'PAYWALL') {
      throw new ForbiddenException('Premium subscription required for this test centre');
    }
  }

  /**
   * Dry-run access check for a route (no claim side-effect). Lets clients decide
   * whether to open the route, show the paywall, or collect test details first.
   */
  async access(userId: string, routeId: string) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, status: RouteStatus.published, deletedAt: null },
      select: { id: true, testCentreId: true, town: true, title: true },
    });
    if (!route) throw new NotFoundException('Route not found');
    const decision = await this.resolveAccess(userId, route, false);
    return {
      allowed: decision === 'ok',
      reason: decision,
      testCentreId: route.testCentreId,
      centreLabel: route.town ?? route.title,
    };
  }

  async list(params: { cursor?: string; take?: number }) {
    const take = Math.min(params.take ?? 20, 50);
    const routes = await this.prisma.route.findMany({
      where: { status: RouteStatus.published, deletedAt: null },
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: [{ qualityScore: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        town: true,
        postcode: true,
        difficulty: true,
        testCentreId: true,
        distanceM: true,
        durationS: true,
        junctionCount: true,
        roundaboutCount: true,
        complexityScore: true,
        qualityScore: true,
        isSample: true,
        isInstructor: true,
        contributor: { select: { id: true, displayName: true, avatarUrl: true, role: true } },
      },
    });
    const nextCursor = routes.length > take ? routes.pop()!.id : null;
    return { items: routes.map((r) => this.withInstructor(r)), nextCursor };
  }

  /** Flatten the contributor relation into instructor fields the clients render. */
  private withInstructor<T extends { contributor?: { id: string; displayName: string; avatarUrl: string | null; role: string } | null }>(
    route: T,
  ) {
    const { contributor, ...rest } = route;
    return {
      ...rest,
      instructorId: contributor?.id ?? null,
      instructorName: contributor?.displayName ?? null,
      instructorAvatar: contributor?.avatarUrl ?? null,
      instructorVerified: contributor?.role === 'instructor' || contributor?.role === 'admin',
    };
  }

  async detail(routeId: string) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, status: RouteStatus.published, deletedAt: null },
      include: { contributor: { select: { id: true, displayName: true, avatarUrl: true, role: true } } },
    });
    if (!route) throw new NotFoundException('Route not found');
    const preview = await this.prisma.$queryRaw`
      SELECT thumbnail_key, map_preview_key FROM route_previews WHERE route_id = ${routeId}::uuid
    `;
    // Attach the owning test centre (name/town) so the detail page can link to it.
    let testCentre: unknown = null;
    if (route.testCentreId) {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT id, name, town, postcode FROM test_centres WHERE id = ${route.testCentreId}::uuid
      `;
      testCentre = rows[0] ?? null;
    }
    return { route: { ...this.withInstructor(route), testCentre }, preview };
  }

  /**
   * An instructor's published routes plus the distinct test centres they cover.
   * Powers the instructor profile page (Phase 20).
   */
  async byInstructor(userId: string) {
    const routes = await this.prisma.route.findMany({
      where: { contributorId: userId, status: RouteStatus.published, deletedAt: null },
      orderBy: [{ qualityScore: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        town: true,
        postcode: true,
        difficulty: true,
        testCentreId: true,
        distanceM: true,
        durationS: true,
        qualityScore: true,
        isSample: true,
        isInstructor: true,
        contributor: { select: { id: true, displayName: true, avatarUrl: true, role: true } },
      },
    });
    const testCentres = await this.prisma.$queryRaw<any[]>`
      SELECT DISTINCT tc.id, tc.name, tc.town, tc.postcode
      FROM routes r
      JOIN test_centres tc ON tc.id = r.test_centre_id
      WHERE r.contributor_id = ${userId}::uuid
        AND r.status = 'published' AND r.deleted_at IS NULL
      ORDER BY tc.name
    `;
    return { routes: routes.map((r) => this.withInstructor(r)), testCentres };
  }

  /**
   * Signed multi-view playback manifest. Free users may only play sample routes;
   * everything else requires premium (multi-view is a premium feature).
   */
  async playback(userId: string, routeId: string) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, status: RouteStatus.published, deletedAt: null },
    });
    if (!route) throw new NotFoundException('Route not found');

    // Test-details gate + per-centre Premium + one-route demo allowance.
    // Claims this route for a demo user on first playback.
    this.enforce(await this.resolveAccess(userId, route, true));

    type VideoRow = {
      view: string;
      rendition: string;
      manifest_key: string;
      storage_key: string;
      sync_offset_ms: number;
    };
    const videos = await this.prisma.$queryRaw<VideoRow[]>`
      SELECT view, rendition, manifest_key, storage_key, sync_offset_ms
      FROM route_videos WHERE route_id = ${routeId}::uuid
    `;

    // Sign each stream's manifest/object; client drives all from one master clock.
    // Absolute URLs (e.g. a CDN or a seeded public test stream) are passed through
    // as-is; storage keys are turned into short-lived signed URLs.
    const streams = await Promise.all(
      videos.map(async (v: VideoRow) => {
        const key = v.manifest_key || v.storage_key;
        const url = /^https?:\/\//.test(key) ? key : await this.storage.presignDownload(key);
        return { view: v.view, rendition: v.rendition, syncOffsetMs: v.sync_offset_ms, url };
      }),
    );

    // Timeline markers (junctions, roundabouts) for the playback scrubber.
    const markers = await this.prisma.$queryRaw`
      SELECT t_ms, kind, label FROM route_markers
      WHERE route_id = ${routeId}::uuid ORDER BY t_ms
    `;

    return {
      routeId,
      durationS: route.durationS,
      syncConfidence: route.syncConfidence,
      junctionCount: route.junctionCount,
      roundaboutCount: route.roundaboutCount,
      streams,
      markers,
    };
  }

  /** Practice mode: GPX-derived instruction set, no video. Gated like playback. */
  async practice(userId: string, routeId: string) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, status: RouteStatus.published, deletedAt: null },
    });
    if (!route) throw new NotFoundException('Route not found');

    // Same gate as playback; claims this route for a demo user on first practice.
    this.enforce(await this.resolveAccess(userId, route, true));

    const instructions = await this.prisma.$queryRaw`
      SELECT seq, t_ms, type, text_ukenglish, roundabout_exit, speed_limit_mph
      FROM route_instructions WHERE route_id = ${routeId}::uuid ORDER BY seq
    `;
    return {
      routeId,
      // Client renders these as turn-by-turn voice prompts via TTS (locale en-GB).
      // No video is shown in practice mode. `text_ukenglish` is ready to speak.
      voice: 'en-GB',
      summary: {
        distanceM: route.distanceM,
        durationS: route.durationS,
        junctionCount: route.junctionCount,
        roundaboutCount: route.roundaboutCount,
        difficulty: route.difficulty,
      },
      instructions,
    };
  }
}
