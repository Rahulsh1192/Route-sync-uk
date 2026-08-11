import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PostcodeService, PostcodeLookup } from '../geo/postcode.service';

export interface TestCentreInput {
  name: string;
  postcode: string;
  town?: string;
  region?: string;
  address?: string;
  description?: string;
}

// Re-exported so existing importers of this symbol keep working now that the
// implementation lives in the shared geo module.
export type { PostcodeLookup } from '../geo/postcode.service';

@Injectable()
export class TestCentresService {
  private readonly logger = new Logger(TestCentresService.name);

  /** Row cap for `list()`. Comfortably above the ~350 centres in the DVSA network. */
  private static readonly LIST_LIMIT = 1000;

  constructor(
    private prisma: PrismaService,
    private postcodes: PostcodeService,
  ) {}

  /**
   * Postcode → town/region/coordinates, for the create form to fill itself in.
   *
   * Exposed as its own endpoint so the form can validate and populate as soon as the
   * postcode is typed, instead of the contributor discovering on submit that the value
   * they entered can't be resolved.
   */
  async lookupPostcode(postcode: string): Promise<PostcodeLookup> {
    const found = await this.postcodes.geocode(postcode);
    if (!found) {
      throw new ServiceUnavailableException(
        'Postcode lookup is temporarily unavailable. You can still save the centre and ' +
          'fill in the town and region yourself.',
      );
    }
    return found;
  }

  /**
   * List test centres (optionally filtered) with a published-route count each.
   *
   * The cap is deliberately well above the size of the DVSA network (~350 centres
   * nationally). It used to be 200, which was under that: once the full list was loaded,
   * everything after the 200th name alphabetically vanished from both the centre list and
   * the upload wizard's "which test centre?" dropdown, with nothing to indicate anything
   * was missing. A centre you cannot select is a centre you cannot upload a route for.
   */
  async list(q?: string) {
    const term = q?.trim();
    // NOTE: COUNT() is int8/bigint; cast to int so it deserialises to a JS number
    // (a raw bigint breaks JSON serialisation of the response).
    const rows = await this.prisma.$queryRaw<any[]>`
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
      LIMIT ${TestCentresService.LIST_LIMIT}
    `;
    // If this ever fires the list is being truncated again, which is the failure that is
    // invisible from the client's side — so it is logged rather than left to be rediscovered
    // by someone wondering why their centre isn't in the dropdown.
    if (rows.length === TestCentresService.LIST_LIMIT) {
      this.logger.warn(
        `Test-centre list hit the ${TestCentresService.LIST_LIMIT}-row cap — results are ` +
          'truncated. Raise LIST_LIMIT or add pagination.',
      );
    }
    return rows;
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
    const postcode = PostcodeService.normalise(input.postcode ?? '');

    // Before the geocoder, not after: this is a local index lookup and it is decisive. When
    // it ran second, adding a centre that already existed reported whatever the third-party
    // lookup happened to say — "postcode lookup unavailable" on a restricted network —
    // instead of "this centre already exists", and spent a pointless external request to get
    // there. A duplicate name cannot be saved whatever the geocoder answers.
    await this.assertNameFree(input.name);

    // Throws for a postcode that genuinely isn't real; returns null only if the lookup
    // service was unreachable, which must not block an admin from saving a centre.
    const found = await this.postcodes.geocode(postcode);
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

    try {
      const rows = await this.prisma.$queryRaw<any[]>`
        INSERT INTO test_centres (name, town, postcode, region, address, description, location)
        VALUES (${input.name}, ${town ?? null}, ${found.postcode},
                ${region ?? null}, ${input.address ?? null}, ${input.description ?? null},
                ST_SetSRID(ST_MakePoint(${found.lng}, ${found.lat}), 4326)::geography)
        RETURNING id, name, town, postcode, region, address, description,
                  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      `;
      return rows[0];
    } catch (e) {
      throw TestCentresService.asDuplicateError(e, input.name);
    }
  }

  /**
   * Reject a name that an existing centre already uses, before attempting the insert.
   *
   * The database has enforced this since Phase 27, but a raw insert that trips a unique
   * index surfaces as a 500 "internal server error" — which tells an admin nothing about
   * what to do. Duplicate centres were a real problem reported from testing (the same
   * centre appearing several times in the list), so the answer "this one already exists"
   * is worth stating properly.
   */
  private async assertNameFree(name: string, excludeId?: string) {
    const clash = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM test_centres
      WHERE tc_norm_name(name) = tc_norm_name(${name})
        AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)
      LIMIT 1
    `;
    if (clash.length) {
      // No worked example here: it would sometimes quote the very name being rejected
      // ("...already exists. Use a name that distinguishes them, e.g. Birmingham (South
      // Yardley)"), which reads as nonsense. The convention is stated instead.
      throw new ConflictException(
        `A test centre called "${clash[0].name}" already exists. If yours is a different ` +
          'centre, include its locality in the name the way DVSA does — town first, then the ' +
          'area in brackets.',
      );
    }
  }

  /**
   * Turn a unique-violation into the same conflict the pre-check raises.
   *
   * Closes the race the pre-check cannot: two admins adding the same centre at once, where
   * the index is the only thing that can decide. 23505 is Postgres' unique_violation.
   */
  private static asDuplicateError(e: unknown, name: string): unknown {
    const code = (e as { meta?: { code?: string } })?.meta?.code;
    if (code === '23505' || /23505|duplicate key/i.test(String((e as Error)?.message))) {
      return new ConflictException(`A test centre called "${name}" already exists.`);
    }
    return e;
  }

  async update(id: string, input: Partial<TestCentreInput>) {
    const existing = await this.findOne(id);

    // Checked first, for the same reason as in `create`: a rename onto an existing name is
    // refused whatever the geocoder says, so there is no point asking it. Excludes this row,
    // so re-saving the form unchanged isn't reported as a clash with itself.
    if (input.name && input.name !== existing.name) {
      await this.assertNameFree(input.name, id);
    }

    // Re-geocode only when the postcode actually changes — compared after normalisation,
    // so re-saving the form with the same postcode typed differently doesn't call out to a
    // third-party service (and can't fail because that service is down).
    let lat = existing.lat as number;
    let lng = existing.lng as number;
    const wanted = input.postcode ? PostcodeService.normalise(input.postcode) : null;
    if (wanted && wanted !== PostcodeService.normalise(existing.postcode ?? '')) {
      const found = await this.postcodes.geocode(wanted);
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
    try {
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
    } catch (e) {
      throw TestCentresService.asDuplicateError(e, input.name ?? existing.name);
    }
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
