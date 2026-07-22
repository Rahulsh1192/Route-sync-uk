import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface TestCentreInput {
  name: string;
  postcode: string;
  town?: string;
  region?: string;
  address?: string;
  description?: string;
}

@Injectable()
export class TestCentresService {
  constructor(private prisma: PrismaService) {}

  /**
   * Geocode a UK postcode to lat/lng via postcodes.io (free, no API key).
   * Throws a 400 if the postcode can't be resolved so the client can show a
   * helpful message on the create/edit form.
   */
  private async geocode(postcode: string): Promise<{ lat: number; lng: number }> {
    const pc = postcode.trim();
    if (!pc) throw new BadRequestException('Postcode is required');
    let body: any;
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new BadRequestException(
          body?.error ?? `Could not look up postcode "${pc}"`,
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException('Postcode lookup service is unavailable, please try again');
    }
    const r = body?.result;
    if (r?.latitude == null || r?.longitude == null) {
      throw new BadRequestException(`Postcode "${pc}" was not found`);
    }
    return { lat: r.latitude, lng: r.longitude };
  }

  /** List test centres (optionally filtered) with a published-route count each. */
  async list(q?: string) {
    const term = q?.trim();
    // NOTE: COUNT() is int8/bigint; cast to int so it deserialises to a JS number
    // (a raw bigint breaks JSON serialisation of the response).
    return this.prisma.$queryRaw<any[]>`
      SELECT tc.id, tc.name, tc.town, tc.postcode, tc.region, tc.address, tc.description,
             ST_Y(tc.location::geometry) AS lat,
             ST_X(tc.location::geometry) AS lng,
             COUNT(r.id) FILTER (WHERE r.status = 'published' AND r.deleted_at IS NULL)::int AS "routeCount"
      FROM test_centres tc
      LEFT JOIN routes r ON r.test_centre_id = tc.id
      WHERE (${term ?? null}::text IS NULL
             OR tc.name ILIKE '%' || ${term ?? ''} || '%'
             OR tc.town ILIKE '%' || ${term ?? ''} || '%'
             OR tc.postcode ILIKE ${term ?? ''} || '%')
      GROUP BY tc.id
      ORDER BY tc.name
      LIMIT 200
    `;
  }

  private async findOne(id: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, name, town, postcode, region, address, description,
             ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM test_centres WHERE id = ${id}::uuid
    `;
    if (!rows.length) throw new NotFoundException('Test centre not found');
    return rows[0];
  }

  /** A single centre plus the published routes that belong to it. */
  async detail(id: string) {
    const centre = await this.findOne(id);
    const routes = await this.prisma.$queryRaw<any[]>`
      SELECT r.id, r.title, r.town, r.postcode, r.difficulty,
             r.distance_m AS "distanceM", r.duration_s AS "durationS",
             r.quality_score AS "qualityScore", r.is_sample AS "isSample",
             r.is_instructor AS "isInstructor",
             u.id AS "instructorId", u.display_name AS "instructorName",
             u.avatar_url AS "instructorAvatar",
             (u.role = 'instructor') AS "instructorVerified"
      FROM routes r
      LEFT JOIN users u ON u.id = r.contributor_id
      WHERE r.test_centre_id = ${id}::uuid
        AND r.status = 'published' AND r.deleted_at IS NULL
      ORDER BY r.is_instructor DESC, r.quality_score DESC NULLS LAST
    `;
    return { centre, routes };
  }

  async create(input: TestCentreInput) {
    const { lat, lng } = await this.geocode(input.postcode);
    const rows = await this.prisma.$queryRaw<any[]>`
      INSERT INTO test_centres (name, town, postcode, region, address, description, location)
      VALUES (${input.name}, ${input.town ?? null}, ${input.postcode},
              ${input.region ?? null}, ${input.address ?? null}, ${input.description ?? null},
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)
      RETURNING id, name, town, postcode, region, address, description,
                ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    `;
    return rows[0];
  }

  async update(id: string, input: Partial<TestCentreInput>) {
    const existing = await this.findOne(id);
    // Re-geocode only when the postcode changes.
    let lat = existing.lat as number;
    let lng = existing.lng as number;
    if (input.postcode && input.postcode.trim() !== existing.postcode) {
      ({ lat, lng } = await this.geocode(input.postcode));
    }
    const rows = await this.prisma.$queryRaw<any[]>`
      UPDATE test_centres SET
        name        = ${input.name ?? existing.name},
        town        = ${input.town ?? existing.town},
        postcode    = ${input.postcode ?? existing.postcode},
        region      = ${input.region ?? existing.region},
        address     = ${input.address ?? existing.address},
        description = ${input.description ?? existing.description},
        location    = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      WHERE id = ${id}::uuid
      RETURNING id, name, town, postcode, region, address, description,
                ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    `;
    return rows[0];
  }

  async remove(id: string) {
    await this.findOne(id);
    // A centre with routes / subscriptions / test-details attached can't be deleted
    // (those rows reference it). Guard with a clear message instead of a raw FK error.
    const [{ count }] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM routes WHERE test_centre_id = ${id}::uuid
    `;
    if (Number(count) > 0) {
      throw new BadRequestException(
        'This test centre still has routes. Reassign or remove them first.',
      );
    }
    await this.prisma.$executeRaw`DELETE FROM test_centres WHERE id = ${id}::uuid`;
    return { ok: true };
  }
}
