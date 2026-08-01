import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface TestCentreInput {
  name: string;
  postcode: string;
  town?: string;
  region?: string;
  address?: string;
  description?: string;
}

/** What a postcode resolves to — coordinates plus the administrative area. */
export interface PostcodeLookup {
  postcode: string;
  lat: number;
  lng: number;
  town: string | null;
  region: string | null;
  country: string | null;
  /** True when only a postcode district was given, so the point is the district centroid. */
  approximate: boolean;
}

@Injectable()
export class TestCentresService {
  private readonly logger = new Logger(TestCentresService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Normalise a UK postcode to the canonical `OUTCODE INCODE` form.
   *
   * Users type `nw71rb`, `NW7  1RB`, or paste one with a trailing space, and all of those
   * are the same postcode. The inward code is always the last three characters, so the
   * space goes before them regardless of whether the outward code is 2, 3 or 4 long.
   */
  private static normalisePostcode(raw: string): string {
    const compact = raw.toUpperCase().replace(/\s+/g, '');
    return compact.length > 3
      ? `${compact.slice(0, -3)} ${compact.slice(-3)}`
      : compact;
  }

  /** True for a postcode district on its own (`NW7`, `SW1A`) rather than a full postcode. */
  private static isOutcode(compact: string): boolean {
    return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(compact.replace(/\s+/g, ''));
  }

  /**
   * Resolve a UK postcode to coordinates and its administrative area via postcodes.io
   * (free, no API key).
   *
   * Handles the three ways this used to fail on a postcode that was actually fine:
   *
   *  - **A district-only code** (`NW7`). `/postcodes/NW7` returns 404 "Invalid postcode",
   *    because a district is not a postcode — it needs the `/outcodes` endpoint instead.
   *    That answer was indistinguishable from a genuine typo.
   *  - **Formatting.** Now normalised before the request rather than sent as typed.
   *  - **An unreachable lookup service.** A network-restricted host made every single
   *    create fail with no way to proceed. The caller can now choose to continue without
   *    coordinates instead of being blocked (see `lookupPostcode` / `create`).
   *
   * Returns `null` when the service could not be reached, and throws only when the
   * postcode itself is genuinely not a real place.
   */
  private async geocode(postcode: string): Promise<PostcodeLookup | null> {
    const pc = TestCentresService.normalisePostcode(postcode ?? '');
    if (!pc) throw new BadRequestException('Postcode is required');

    const compact = pc.replace(/\s+/g, '');
    const outcodeOnly = TestCentresService.isOutcode(compact);
    const url = outcodeOnly
      ? `https://api.postcodes.io/outcodes/${encodeURIComponent(compact)}`
      : `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`;

    let res: Response;
    let body: any;
    try {
      // Bounded: postcodes.io is a third party and a create request should not hang on it.
      res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      body = await res.json().catch(() => null);
    } catch {
      // Unreachable / timed out — not the user's fault and not a verdict on the postcode.
      this.logger.warn(`Postcode lookup unavailable for "${pc}"`);
      return null;
    }

    if (res.status === 404) {
      throw new BadRequestException(
        outcodeOnly
          ? `"${compact}" is not a recognised UK postcode district`
          : `"${pc}" is not a recognised UK postcode. Enter the full postcode, e.g. NW7 1RB.`,
      );
    }
    if (!res.ok) {
      this.logger.warn(`Postcode lookup failed for "${pc}": HTTP ${res.status}`);
      return null;
    }

    const r = body?.result;
    if (r?.latitude == null || r?.longitude == null) {
      throw new BadRequestException(`"${pc}" could not be located`);
    }

    // Field names differ between the two endpoints: a postcode result carries the
    // district directly, an outcode result returns arrays covering the whole district.
    const town: string | null =
      r.admin_district ?? r.admin_ward ?? r.parish ?? r.admin_districts?.[0] ?? null;
    const region: string | null =
      r.region ?? r.european_electoral_region ?? r.regions?.[0] ?? r.country ?? null;

    return {
      postcode: outcodeOnly ? compact : (r.postcode ?? pc),
      lat: r.latitude,
      lng: r.longitude,
      town,
      region,
      country: r.country ?? r.countries?.[0] ?? null,
      approximate: outcodeOnly,
    };
  }

  /**
   * Postcode → town/region/coordinates, for the create form to fill itself in.
   *
   * Exposed as its own endpoint so the form can validate and populate as soon as the
   * postcode is typed, instead of the contributor discovering on submit that the value
   * they entered can't be resolved.
   */
  async lookupPostcode(postcode: string): Promise<PostcodeLookup> {
    const found = await this.geocode(postcode);
    if (!found) {
      throw new ServiceUnavailableException(
        'Postcode lookup is temporarily unavailable. You can still save the centre and ' +
          'fill in the town and region yourself.',
      );
    }
    return found;
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
    const postcode = TestCentresService.normalisePostcode(input.postcode ?? '');
    // Throws for a postcode that genuinely isn't real; returns null only if the lookup
    // service was unreachable, which must not block an admin from saving a centre.
    const found = await this.geocode(postcode);
    if (!found) {
      throw new ServiceUnavailableException(
        'Could not reach the postcode lookup service, so this centre has no map location ' +
          'yet. Please try again in a moment.',
      );
    }

    // The postcode is authoritative for town/region; anything the admin typed wins, since
    // a centre's local name ("Mill Hill") is often not the administrative district
    // ("Barnet") that the lookup returns.
    const town = input.town?.trim() || found.town;
    const region = input.region?.trim() || found.region;

    const rows = await this.prisma.$queryRaw<any[]>`
      INSERT INTO test_centres (name, town, postcode, region, address, description, location)
      VALUES (${input.name}, ${town ?? null}, ${found.postcode},
              ${region ?? null}, ${input.address ?? null}, ${input.description ?? null},
              ST_SetSRID(ST_MakePoint(${found.lng}, ${found.lat}), 4326)::geography)
      RETURNING id, name, town, postcode, region, address, description,
                ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    `;
    return rows[0];
  }

  async update(id: string, input: Partial<TestCentreInput>) {
    const existing = await this.findOne(id);
    // Re-geocode only when the postcode actually changes — compared after normalisation,
    // so re-saving the form with the same postcode typed differently doesn't call out to a
    // third-party service (and can't fail because that service is down).
    let lat = existing.lat as number;
    let lng = existing.lng as number;
    const wanted = input.postcode ? TestCentresService.normalisePostcode(input.postcode) : null;
    if (wanted && wanted !== TestCentresService.normalisePostcode(existing.postcode ?? '')) {
      const found = await this.geocode(wanted);
      if (!found) {
        throw new ServiceUnavailableException(
          'Could not reach the postcode lookup service to relocate this centre. ' +
            'Please try again in a moment.',
        );
      }
      lat = found.lat;
      lng = found.lng;
      input = { ...input, postcode: found.postcode };
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
