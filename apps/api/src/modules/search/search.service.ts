import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface RouteSearchParams {
  testCentre?: string;
  town?: string;
  postcode?: string;
  difficulty?: string;
  contributor?: string;
  instructor?: boolean;
  q?: string;
  take?: number;
}

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  /**
   * Route search across test centre / town / postcode / difficulty / contributor /
   * instructor, with optional full-text query. Verified-instructor routes get a
   * search boost via the ORDER BY (is_instructor DESC).
   */
  async routes(p: RouteSearchParams) {
    const take = Math.min(p.take ?? 20, 50);
    return this.prisma.$queryRaw`
      SELECT r.id, r.title, r.town, r.postcode, r.difficulty,
             r.distance_m, r.duration_s, r.quality_score, r.is_instructor
      FROM routes r
      LEFT JOIN test_centres tc ON tc.id = r.test_centre_id
      LEFT JOIN users u ON u.id = r.contributor_id
      WHERE r.status = 'published' AND r.deleted_at IS NULL
        AND (${p.testCentre ?? null}::text IS NULL OR tc.name ILIKE '%' || ${p.testCentre} || '%')
        AND (${p.town ?? null}::text IS NULL OR r.town ILIKE '%' || ${p.town} || '%')
        AND (${p.postcode ?? null}::text IS NULL OR r.postcode ILIKE ${p.postcode ?? ''} || '%')
        AND (${p.difficulty ?? null}::route_difficulty IS NULL OR r.difficulty = ${p.difficulty ?? null}::route_difficulty)
        AND (${p.contributor ?? null}::text IS NULL OR u.display_name ILIKE '%' || ${p.contributor} || '%')
        AND (${p.instructor ?? null}::boolean IS NULL OR r.is_instructor = ${p.instructor ?? null}::boolean)
        AND (${p.q ?? null}::text IS NULL OR
             to_tsvector('english', coalesce(r.title,'') || ' ' || coalesce(r.town,'') || ' ' || coalesce(r.postcode,''))
             @@ plainto_tsquery('english', ${p.q ?? ''}))
      ORDER BY r.is_instructor DESC, r.quality_score DESC NULLS LAST
      LIMIT ${take}
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
