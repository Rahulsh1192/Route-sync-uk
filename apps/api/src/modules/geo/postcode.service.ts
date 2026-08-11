import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

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

/**
 * UK postcode → coordinates, via postcodes.io (free, no API key).
 *
 * Extracted from TestCentresService in Phase 27 so instructor search can resolve a learner's
 * postcode with the same implementation. Two copies would have drifted: the original had
 * accumulated fixes for district-only codes, formatting, and an unreachable lookup service,
 * and a second copy written for bookings would have started without any of them — which is
 * how "search by postcode" ends up quietly not working for half the postcodes people type.
 */
@Injectable()
export class PostcodeService {
  private readonly logger = new Logger(PostcodeService.name);

  /**
   * Normalise a UK postcode to the canonical `OUTCODE INCODE` form.
   *
   * Users type `nw71rb`, `NW7  1RB`, or paste one with a trailing space, and all of those
   * are the same postcode. The inward code is always the last three characters, so the
   * space goes before them regardless of whether the outward code is 2, 3 or 4 long.
   */
  static normalise(raw: string): string {
    const compact = (raw ?? '').toUpperCase().replace(/\s+/g, '');
    return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
  }

  /** True for a postcode district on its own (`NW7`, `SW1A`) rather than a full postcode. */
  static isOutcode(raw: string): boolean {
    return /^[A-Z]{1,2}\d[A-Z\d]?$/.test((raw ?? '').toUpperCase().replace(/\s+/g, ''));
  }

  /**
   * Resolve a postcode to coordinates and its administrative area.
   *
   * Handles the three ways this used to fail on a postcode that was actually fine:
   *
   *  - **A district-only code** (`NW7`). `/postcodes/NW7` returns 404 "Invalid postcode",
   *    because a district is not a postcode — it needs the `/outcodes` endpoint instead.
   *    That answer was indistinguishable from a genuine typo.
   *  - **Formatting.** Normalised before the request rather than sent as typed.
   *  - **An unreachable lookup service.** A network-restricted host made every single
   *    create fail with no way to proceed. The caller can now choose to continue without
   *    coordinates instead of being blocked.
   *
   * Returns `null` when the service could not be reached, and throws only when the postcode
   * itself is genuinely not a real place.
   */
  async geocode(postcode: string): Promise<PostcodeLookup | null> {
    const pc = PostcodeService.normalise(postcode);
    if (!pc) throw new BadRequestException('Postcode is required');

    const compact = pc.replace(/\s+/g, '');
    const outcodeOnly = PostcodeService.isOutcode(compact);
    const url = outcodeOnly
      ? `https://api.postcodes.io/outcodes/${encodeURIComponent(compact)}`
      : `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`;

    let res: Response;
    let body: any;
    try {
      // Bounded: postcodes.io is a third party and a request should not hang on it.
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

    // Field names differ between the two endpoints: a postcode result carries the district
    // directly, an outcode result returns arrays covering the whole district.
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
   * Like `geocode`, but treats an unreachable lookup service as an error.
   *
   * For callers that have nothing useful to do without coordinates — a proximity search
   * cannot silently become a non-proximity search, because the learner would be shown
   * instructors from anywhere in the country as though they were local.
   */
  async require(postcode: string): Promise<PostcodeLookup> {
    const found = await this.geocode(postcode);
    if (!found) {
      throw new ServiceUnavailableException(
        'Postcode lookup is temporarily unavailable, so we cannot work out what is near ' +
          'you. Please try again in a moment.',
      );
    }
    return found;
  }
}
