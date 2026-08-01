import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { RouteStatus } from '@prisma/client';

/** Camera views a route can have footage for. Anchors the HLS gateway's path check. */
const VIEWS = ['front', 'rear'] as const;

/**
 * Files the HLS gateway will resolve. Deliberately a whitelist of a bare name plus one
 * known extension: no slashes, no dots beyond the extension, so `../`, absolute paths and
 * encoded traversal cannot survive it. The gateway then builds the object key itself from
 * the route id, so a request can only ever address assets belonging to its own route.
 */
const HLS_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(m3u8|ts|m4s|mp4|vtt)$/;

@Injectable()
export class RoutesService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private subs: SubscriptionsService,
    private config: ConfigService,
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

  // ---- signed HLS delivery ---------------------------------------------------

  /**
   * Mint a playback token for one user + one route.
   *
   * Why this exists: an HLS master playlist references its variant playlists, and those
   * reference their segments, by *relative* name. A player resolves those against the
   * master's URL and drops its query string — so handing the player a presigned master
   * makes every follow-up request arrive unsigned, and object storage rejects the lot.
   * Signing each segment up front is not an option either: there are hundreds, and the
   * player decides which it wants at runtime.
   *
   * So the token goes in the URL *path*, where relative resolution preserves it, and the
   * gateway signs each asset on demand. The token is an HMAC over the route, the user and
   * an expiry, keyed with the existing JWT secret — it is only issued by `playback()`
   * after the paywall check has passed, so possession proves entitlement was granted.
   * Same exposure as the presigned URLs already in use (a leaked token is valid until it
   * expires) and the user id makes a leak attributable, which a presigned URL does not.
   */
  private issueHlsToken(userId: string, routeId: string): string {
    const exp = Math.floor(Date.now() / 1000) + this.hlsTokenTtl();
    const payload = `${routeId}.${userId}.${exp}`;
    return `${Buffer.from(payload).toString('base64url')}.${this.hlsSignature(payload)}`;
  }

  private hlsSignature(payload: string): string {
    return createHmac('sha256', this.config.get<string>('JWT_ACCESS_SECRET')!)
      .update(payload)
      .digest('base64url');
  }

  private hlsTokenTtl(): number {
    // Matches the signed-URL lifetime: the token's job is to keep one viewing session
    // working, and the URLs it hands out expire on the same clock anyway.
    return this.config.get<number>('SIGNED_URL_TTL') ?? 3600;
  }

  /**
   * Verify a playback token and return the user it was issued to.
   *
   * Rejects a token minted for a different route even if the signature is valid, so one
   * route's token cannot be replayed against another's footage.
   */
  private verifyHlsToken(token: string, routeId: string): string {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) throw new ForbiddenException('Malformed playback token');

    let payload: string;
    try {
      payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      throw new ForbiddenException('Malformed playback token');
    }

    const expected = Buffer.from(this.hlsSignature(payload));
    const actual = Buffer.from(signature);
    // Constant-time compare, length-checked first: timingSafeEqual throws on a length
    // mismatch, and an early return on length leaks nothing (the length is fixed).
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new ForbiddenException('Invalid playback token');
    }

    const [tokenRouteId, userId, exp] = payload.split('.');
    if (tokenRouteId !== routeId) throw new ForbiddenException('Token is for a different route');
    if (!Number(exp) || Number(exp) * 1000 < Date.now()) {
      throw new ForbiddenException('Playback token has expired');
    }
    return userId;
  }

  /**
   * The object key prefix the worker writes a view's HLS ladder to.
   * Kept in one place because the gateway's path handling depends on it.
   */
  private hlsPrefix(routeId: string, view: string): string {
    return `routes/${routeId}/${view}/hls/`;
  }

  /**
   * Authorise one HLS asset request and say how to serve it.
   *
   * Playlists are returned as text; media is returned as a URL to redirect to. The split
   * matters: a player resolves a playlist's relative references against the URL it was
   * *finally* served from, so if a playlist were redirected to storage, the segment
   * requests derived from it would be addressed to storage unsigned and rejected. Serving
   * the playlist from this endpoint keeps that resolution pointing back here, where each
   * segment gets authorised and signed in turn. Playlists are a couple of kilobytes of
   * text, so this is not the API streaming video — the media itself never passes through.
   *
   * The object key is assembled from the token-bound route id, a whitelisted view and a
   * whitelisted filename: nothing the caller sends reaches a path unchecked.
   */
  async hlsAsset(
    routeId: string,
    token: string,
    view: string,
    file: string,
  ): Promise<{ kind: 'playlist'; body: string } | { kind: 'redirect'; url: string }> {
    this.verifyHlsToken(token, routeId);

    if (!(VIEWS as readonly string[]).includes(view)) {
      throw new BadRequestException(`Unknown view '${view}'`);
    }
    if (!HLS_FILE.test(file)) {
      throw new BadRequestException('Unsupported HLS asset name');
    }

    const key = `${this.hlsPrefix(routeId, view)}${file}`;

    if (file.endsWith('.m3u8')) {
      const body = await this.storage.getText(key);
      if (body === null) throw new NotFoundException('Playlist not found');
      return { kind: 'playlist', body };
    }

    // Segments are fetched once each, so a short TTL is plenty and keeps the window on a
    // leaked URL small.
    return { kind: 'redirect', url: await this.storage.presignDownload(key, 900) };
  }

  /**
   * Playback URL for a stored manifest/object.
   *
   * Routes the request through the gateway only when the stored key is a ladder master in
   * the layout the gateway understands — anything else (an absolute seeded URL, a single
   * self-contained MP4, an unrecognised key) keeps the existing signing behaviour, so no
   * previously-working row changes shape.
   */
  private async streamUrl(
    routeId: string,
    view: string,
    key: string,
    token: string,
  ): Promise<string> {
    const isLadderMaster =
      key === `${this.hlsPrefix(routeId, view)}index.m3u8` && (VIEWS as readonly string[]).includes(view);
    if (!isLadderMaster) return this.storage.resolveUrl(key, 'master');

    const base = (this.config.get<string>('API_BASE_URL') ?? '').replace(/\/+$/, '');
    return `${base}/api/routes/${routeId}/hls/${token}/${view}/index.m3u8`;
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
    const preview = await this.previewUrls(routeId);
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
      variants: unknown;
      codec: string | null;
      width: number | null;
      height: number | null;
    };
    const videos = await this.prisma.$queryRaw<VideoRow[]>`
      SELECT view, rendition, manifest_key, storage_key, sync_offset_ms,
             variants, codec, width, height
      FROM route_videos WHERE route_id = ${routeId}::uuid
    `;

    // Resolve each stream's manifest/object; client drives all from one master clock.
    // Video is never public: an ABR master goes through the signed HLS gateway (so its
    // relative variant/segment references stay authorised), and anything else is signed
    // directly. Absolute URLs (a seeded public test stream) pass through untouched.
    const token = this.issueHlsToken(userId, routeId);
    const streams = await Promise.all(
      videos.map(async (v: VideoRow) => {
        const key = v.manifest_key || v.storage_key;
        return {
          view: v.view,
          rendition: v.rendition,
          syncOffsetMs: v.sync_offset_ms,
          url: await this.streamUrl(routeId, v.view, key, token),
          codec: v.codec,
          width: v.width,
          height: v.height,
          // The ABR ladder, so the UI can show available qualities. hls.js still picks
          // the rendition itself from the master playlist — this is for display only.
          variants: v.variants ?? null,
        };
      }),
    );

    // Timeline markers (junctions, roundabouts) for the playback scrubber.
    const markers = await this.prisma.$queryRaw`
      SELECT t_ms, kind, label FROM route_markers
      WHERE route_id = ${routeId}::uuid ORDER BY t_ms
    `;

    // Phase 24: the geometry that makes the map follow playback. Shipped inside the
    // playback manifest rather than behind a second request so the player has the
    // whole timeline before the first frame — fetching it separately would leave the
    // marker stranded at the start while the video is already moving.
    const track = await this.trackPoints(routeId);
    const clipTimeline = await this.clipTimeline(routeId);

    return {
      routeId,
      durationS: route.durationS,
      syncConfidence: route.syncConfidence,
      junctionCount: route.junctionCount,
      roundaboutCount: route.roundaboutCount,
      streams,
      markers,
      track,
      clipTimeline,
      // Phase 25: poster image for the player, from the CDN when one is configured.
      preview: await this.previewUrls(routeId),
    };
  }

  /**
   * Thumbnail/preview URLs for a route.
   *
   * Thumbnails are the one asset class served from the public CDN by default: they are
   * already visible on unpaid listing pages, so there is nothing to protect, and they
   * are requested far more often than the video itself — which is exactly the workload
   * a CDN edge cache is for. Both sizes are returned so a list view can request the
   * 320-wide image instead of scaling down the 640-wide one.
   */
  private async previewUrls(routeId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        thumbnail_key: string | null;
        thumbnail_small_key: string | null;
        map_preview_key: string | null;
        captured_at_ms: number | null;
      }>
    >`
      SELECT thumbnail_key, thumbnail_small_key, map_preview_key, captured_at_ms
        FROM route_previews WHERE route_id = ${routeId}::uuid`;
    const p = rows[0];
    if (!p) return null;

    const resolve = (key: string | null) =>
      key ? this.storage.resolveUrl(key, 'thumbnail') : Promise.resolve(null);

    const [thumbnailUrl, thumbnailSmallUrl, mapPreviewUrl] = await Promise.all([
      resolve(p.thumbnail_key),
      resolve(p.thumbnail_small_key),
      resolve(p.map_preview_key),
    ]);

    return {
      thumbnailUrl,
      thumbnailSmallUrl,
      mapPreviewUrl,
      capturedAtMs: p.captured_at_ms,
      // Kept for backwards compatibility with any consumer already reading the raw keys.
      thumbnail_key: p.thumbnail_key,
      map_preview_key: p.map_preview_key,
    };
  }

  /**
   * The route's GPS track on the playback clock — what the moving map marker reads.
   *
   * Points are returned in `t_ms` order with a bearing, so the client only has to
   * find the surrounding pair and interpolate. Off-route points are excluded: they
   * were spliced out of the video, so showing them would jump the marker to places
   * the footage never visits.
   */
  private trackPoints(routeId: string) {
    return this.prisma.$queryRaw<
      Array<{ tMs: number; lat: number; lng: number; speedMps: number | null; bearingDeg: number | null }>
    >`
      SELECT t_ms::float8                    AS "tMs",
             ST_Y(location::geometry)        AS lat,
             ST_X(location::geometry)        AS lng,
             speed_mps::float8               AS "speedMps",
             bearing_deg::float8             AS "bearingDeg"
        FROM route_track_points
       WHERE route_id = ${routeId}::uuid
         AND on_route
       ORDER BY t_ms`;
  }

  /**
   * Per-clip mapping from concatenated-video time to wall-clock time.
   *
   * Dashcams drop time between clips, so video time and elapsed real time are not
   * the same quantity. Clients that want to show a real timestamp (or reason about
   * the recording) map through this; playback itself stays driven by video time.
   */
  private clipTimeline(routeId: string) {
    return this.prisma.$queryRaw<
      Array<{
        view: string;
        clipSeq: number;
        videoStartMs: number;
        videoEndMs: number;
        wallStartEpochMs: number;
        gapBeforeMs: number;
      }>
    >`
      SELECT view,
             clip_seq                        AS "clipSeq",
             video_start_ms::float8          AS "videoStartMs",
             video_end_ms::float8            AS "videoEndMs",
             wall_start_epoch_ms::float8     AS "wallStartEpochMs",
             gap_before_ms::float8           AS "gapBeforeMs"
        FROM route_clip_timeline
       WHERE route_id = ${routeId}::uuid
       ORDER BY view, clip_seq`;
  }

  /**
   * Standalone track fetch, entitlement-gated like playback.
   *
   * Exists for clients that render the map without the video (map-only routes, the
   * mobile Map view, an admin reviewing geometry) and so a long track can be
   * re-fetched without re-signing every video URL.
   */
  async track(userId: string, routeId: string) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, status: RouteStatus.published, deletedAt: null },
      select: { id: true, testCentreId: true, durationS: true, distanceM: true },
    });
    if (!route) throw new NotFoundException('Route not found');
    this.enforce(await this.resolveAccess(userId, route, true));

    const track = await this.trackPoints(routeId);
    return {
      routeId,
      durationS: route.durationS,
      distanceM: route.distanceM,
      pointCount: track.length,
      track,
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
