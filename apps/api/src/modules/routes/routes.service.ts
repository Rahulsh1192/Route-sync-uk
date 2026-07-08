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
        distanceM: true,
        durationS: true,
        junctionCount: true,
        roundaboutCount: true,
        complexityScore: true,
        qualityScore: true,
        isSample: true,
        isInstructor: true,
      },
    });
    const nextCursor = routes.length > take ? routes.pop()!.id : null;
    return { items: routes, nextCursor };
  }

  async detail(routeId: string) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, status: RouteStatus.published, deletedAt: null },
    });
    if (!route) throw new NotFoundException('Route not found');
    const preview = await this.prisma.$queryRaw`
      SELECT thumbnail_key, map_preview_key FROM route_previews WHERE route_id = ${routeId}::uuid
    `;
    return { route, preview };
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

    if (!route.isSample) {
      const premium = await this.subs.isPremium(userId);
      if (!premium) throw new ForbiddenException('Premium subscription required');
    }

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

  /** Practice mode: GPX-derived instruction set, no video. Premium-gated. */
  async practice(userId: string, routeId: string) {
    const premium = await this.subs.isPremium(userId);
    if (!premium) throw new ForbiddenException('Premium subscription required');

    const route = await this.prisma.route.findFirst({
      where: { id: routeId, status: RouteStatus.published, deletedAt: null },
    });
    if (!route) throw new NotFoundException('Route not found');

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
