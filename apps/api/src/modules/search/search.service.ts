import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  /**
   * Phase 20 global route search: a single query term matched across route title,
   * instructor (contributor) name, test centre name, town/city and postcode.
   * Verified-instructor routes get a search boost via the ORDER BY.
   */
  async routes(q?: string, take = 50) {
    const term = q?.trim() || null;
    const lim = Math.min(take, 100);
    return this.prisma.$queryRaw`
      SELECT r.id, r.title, r.town, r.postcode, r.difficulty,
             r.test_centre_id AS "testCentreId",
             r.distance_m AS "distanceM", r.duration_s AS "durationS",
             r.quality_score AS "qualityScore",
             r.is_sample AS "isSample", r.is_instructor AS "isInstructor",
             u.id AS "instructorId", u.display_name AS "instructorName",
             u.avatar_url AS "instructorAvatar",
             (u.role IN ('instructor','admin')) AS "instructorVerified"
      FROM routes r
      LEFT JOIN test_centres tc ON tc.id = r.test_centre_id
      LEFT JOIN users u ON u.id = r.contributor_id
      WHERE r.status = 'published' AND r.deleted_at IS NULL
        AND (${term}::text IS NULL
             OR r.title ILIKE '%' || ${term} || '%'
             OR u.display_name ILIKE '%' || ${term} || '%'
             OR tc.name ILIKE '%' || ${term} || '%'
             OR r.town ILIKE '%' || ${term} || '%'
             OR tc.town ILIKE '%' || ${term} || '%'
             OR r.postcode ILIKE '%' || ${term} || '%'
             OR tc.postcode ILIKE '%' || ${term} || '%')
      ORDER BY r.is_instructor DESC, r.quality_score DESC NULLS LAST
      LIMIT ${lim}
    `;
  }

  /** Nearest test centres to a coordinate (PostGIS KNN). */
  async testCentresNear(lat: number, lng: number, take = 10) {
    return this.prisma.$queryRaw`
      SELECT id, name, town, postcode,
             ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS meters
      FROM test_centres
      ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      LIMIT ${take}
    `;
  }

  /**
   * List / text-search test centres by name, town or postcode. Powers the
   * test-details picker (Phase 19b). Empty query returns an alphabetical page.
   */
  async testCentresSearch(q?: string, take = 20) {
    const term = q?.trim();
    if (term) {
      return this.prisma.$queryRaw`
        SELECT id, name, town, postcode
        FROM test_centres
        WHERE name ILIKE '%' || ${term} || '%'
           OR town ILIKE '%' || ${term} || '%'
           OR postcode ILIKE ${term} || '%'
        ORDER BY name
        LIMIT ${take}
      `;
    }
    return this.prisma.$queryRaw`
      SELECT id, name, town, postcode FROM test_centres ORDER BY name LIMIT ${take}
    `;
  }
}
