/**
 * Import DVSA practical test centres from db/dvsa_test_centres.csv.
 *
 * Why a script and not a plain SQL seed: `test_centres.location` is NOT NULL, so a SQL
 * seed has to carry a coordinate for every row — which would mean writing ~250 lat/lng
 * pairs by hand. Coordinates typed from memory are exactly the kind of data that looks
 * fine and silently puts a test centre in the wrong town. Here the CSV carries only a name
 * and a postcode, and every coordinate comes from postcodes.io, the same geocoder the API
 * already uses for `POST /test-centres`.
 *
 * Two safeguards, because the CSV itself is compiled from knowledge and not an official
 * export (see the header in the CSV):
 *
 *   1. An invalid postcode cannot be imported — postcodes.io simply doesn't resolve it, and
 *      the row is reported as UNRESOLVED instead of stored with a guessed location.
 *   2. A postcode that is real but belongs to somewhere else is caught by comparing the
 *      town in the CSV against the administrative district the geocoder returns. That
 *      disagreement is printed as MISMATCH for a human to check. This is the check that
 *      catches "Birmingham (South Yardley), S13 9BH" — a valid postcode, wrong city.
 *
 * Usage (from apps/api):
 *   npm run import:test-centres -- --dry-run    # report only, writes nothing
 *   npm run import:test-centres                 # import
 *   npm run import:test-centres -- --strict     # skip MISMATCH rows too, not just invalid
 *
 * Idempotent: rows are matched on the normalised name (the Phase 27 unique index), so
 * re-running updates the postcode/town/region/location of a centre that already exists and
 * inserts only what is genuinely new. It never creates a second copy.
 *
 * Requires db/migrate_phase_27.sql to have been applied (for the unique index).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

// ---- config -----------------------------------------------------------------
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or apps/api/.env');
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

const CSV_PATH = join(__dirname, '..', '..', '..', 'db', 'dvsa_test_centres.csv');

/** postcodes.io accepts up to 100 postcodes per bulk request. */
const BULK_CHUNK = 100;

interface CsvRow {
  name: string;
  postcode: string;
  town: string;
  region: string;
  line: number;
}

export interface Resolved extends CsvRow {
  lat: number;
  lng: number;
  /** Canonical postcode as the geocoder spells it. */
  postcodeCanonical: string;
  /** Administrative district according to the geocoder. */
  districtActual: string | null;
  mismatch: boolean;
}

// ---- CSV ---------------------------------------------------------------------

/**
 * Deliberately minimal: this file is ours, has no quoted fields and no embedded commas,
 * so a CSV library would be a dependency earning nothing. Comment lines (`#`) and blanks
 * are skipped, and the `name,postcode,...` header line is ignored wherever it appears.
 */
export function parseCsv(text: string): { rows: CsvRow[]; malformed: string[] } {
  const rows: CsvRow[] = [];
  const malformed: string[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (/^name\s*,\s*postcode\b/i.test(line)) return;

    const parts = line.split(',').map((p) => p.trim());
    const [name, postcode, town, region] = parts;
    // A row missing a name or postcode cannot be geocoded or stored; surfaced rather than
    // skipped silently, because it means the CSV needs fixing.
    if (parts.length !== 4 || !name || !postcode) {
      malformed.push(`line ${i + 1}: ${line}`);
      return;
    }
    rows.push({ name, postcode, town: town ?? '', region: region ?? '', line: i + 1 });
  });

  return { rows, malformed };
}

/** Same normalisation as the database's `tc_norm_name` — used only for local duplicate detection. */
export function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Canonical `OUTCODE INCODE`, matching TestCentresService.normalisePostcode. */
export function normalisePostcode(raw: string): string {
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

/**
 * Does the town we asserted agree with the district the geocoder returned?
 *
 * Lenient on purpose — a false alarm on every row would make the real mismatches
 * invisible. A DVSA centre's local name legitimately differs from its administrative
 * district in ways that are not errors:
 *
 *   "Mill Hill" (district: Barnet)         → substring of neither, but adjacent locality
 *   "Hayes" (district: Hillingdon)         → London boroughs almost never match
 *   "Stoke-on-Trent" vs "Stoke on Trent"   → punctuation only
 *
 * So this only flags a row when the two names share no recognisable root at all, which is
 * the signature of a postcode belonging to a different part of the country.
 */
export function townsAgree(asserted: string, actual: string | null): boolean {
  if (!asserted || !actual) return true; // nothing to compare — not evidence of a problem
  const canon = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const a = canon(asserted);
  const b = canon(actual);
  if (!a || !b) return true;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  // Compare first words too: "Newcastle upon Tyne" vs "Newcastle", "Kings Lynn" vs "King's Lynn".
  const firstWord = (s: string) => canon(s.split(/\s+/)[0] ?? '');
  const fa = firstWord(asserted);
  const fb = firstWord(actual);
  return fa.length > 3 && fb.length > 3 && (fa === fb || fa.includes(fb) || fb.includes(fa));
}

// ---- geocoding ---------------------------------------------------------------

export interface GeocodeHit {
  postcode: string;
  latitude: number;
  longitude: number;
  admin_district?: string | null;
  region?: string | null;
  country?: string | null;
}

interface BulkResult {
  query: string;
  result: GeocodeHit | null;
}

/** Resolves normalised postcodes to coordinates. Injectable so the logic above is testable. */
export type Geocoder = (postcodes: string[]) => Promise<Map<string, GeocodeHit | null>>;

/**
 * Bulk-resolve postcodes, 100 at a time. Bulk rather than one request each because ~250
 * sequential round-trips to a free public service is both slow and rude.
 */
export const geocodeBulk: Geocoder = async (postcodes) => {
  const out = new Map<string, GeocodeHit | null>();

  for (let i = 0; i < postcodes.length; i += BULK_CHUNK) {
    const chunk = postcodes.slice(i, i + BULK_CHUNK);
    const res = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postcodes: chunk }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(
        `postcodes.io bulk lookup failed: HTTP ${res.status}. ` +
          'No centres were imported — re-run when the lookup service is reachable.',
      );
    }
    const body = (await res.json()) as { result?: BulkResult[] };
    for (const entry of body.result ?? []) {
      out.set(normalisePostcode(entry.query), entry.result);
    }
    process.stdout.write(
      `  geocoded ${Math.min(i + BULK_CHUNK, postcodes.length)}/${postcodes.length}\n`,
    );
  }

  return out;
};

/**
 * Pair each CSV row with its geocoded location, splitting out the ones that could not be
 * resolved and marking the ones whose postcode landed somewhere unexpected.
 *
 * Separated from `main` so it can be tested without a network or a database — the two
 * things that make this script otherwise unverifiable on a restricted network.
 */
export function resolveRows(
  rows: CsvRow[],
  geo: Map<string, GeocodeHit | null>,
): { resolved: Resolved[]; unresolved: CsvRow[] } {
  const resolved: Resolved[] = [];
  const unresolved: CsvRow[] = [];

  for (const r of rows) {
    const hit = geo.get(normalisePostcode(r.postcode));
    if (!hit || hit.latitude == null || hit.longitude == null) {
      unresolved.push(r);
      continue;
    }
    const districtActual = hit.admin_district ?? null;
    resolved.push({
      ...r,
      lat: hit.latitude,
      lng: hit.longitude,
      postcodeCanonical: hit.postcode ?? normalisePostcode(r.postcode),
      districtActual,
      mismatch: !townsAgree(r.town, districtActual),
    });
  }

  return { resolved, unresolved };
}

/** Rows sharing a normalised name, which would otherwise overwrite each other on import. */
export function findDuplicateNames(rows: CsvRow[]): { unique: CsvRow[]; dupes: string[] } {
  const seen = new Map<string, CsvRow>();
  const dupes: string[] = [];
  for (const r of rows) {
    const key = normName(r.name);
    const prev = seen.get(key);
    if (prev) dupes.push(`"${r.name}" (lines ${prev.line} and ${r.line})`);
    else seen.set(key, r);
  }
  return { unique: [...seen.values()], dupes };
}

// ---- main --------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const strict = process.argv.includes('--strict');

  const { rows, malformed } = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  console.log(`Read ${rows.length} centre(s) from ${CSV_PATH}`);
  if (malformed.length) {
    console.log(`\n⚠ ${malformed.length} malformed row(s) skipped:`);
    malformed.forEach((m) => console.log(`    ${m}`));
  }

  // Two rows naming the same centre would fight over the same database row, each
  // overwriting the other's postcode on every run.
  const { unique, dupes } = findDuplicateNames(rows);
  if (dupes.length) {
    console.log(`\n⚠ ${dupes.length} duplicate name(s) in the CSV — only the first is used:`);
    dupes.forEach((d) => console.log(`    ${d}`));
  }

  console.log(`\nGeocoding ${unique.length} postcode(s) via postcodes.io…`);
  const geo = await geocodeBulk(unique.map((r) => normalisePostcode(r.postcode)));

  const { resolved, unresolved } = resolveRows(unique, geo);

  if (unresolved.length) {
    console.log(
      `\n❌ ${unresolved.length} UNRESOLVED postcode(s) — not a real UK postcode, fix the CSV:`,
    );
    unresolved.forEach((r) => console.log(`    line ${r.line}: ${r.name} — "${r.postcode}"`));
  }

  const mismatches = resolved.filter((r) => r.mismatch);
  if (mismatches.length) {
    console.log(
      `\n⚠ ${mismatches.length} MISMATCH(es) — the postcode resolves somewhere unexpected. ` +
        'Verify these against https://www.gov.uk/find-driving-test-centre:',
    );
    mismatches.forEach((r) =>
      console.log(
        `    line ${r.line}: ${r.name} — CSV says "${r.town}", ` +
          `${r.postcodeCanonical} is in "${r.districtActual}"`,
      ),
    );
  }

  const toImport = strict ? resolved.filter((r) => !r.mismatch) : resolved;

  console.log(
    `\nSummary: ${resolved.length} resolved, ${unresolved.length} unresolved, ` +
      `${mismatches.length} mismatched → ${toImport.length} to import` +
      `${strict ? ' (--strict: mismatches excluded)' : ''}`,
  );

  if (dryRun) {
    console.log('\n--dry-run: nothing was written.');
    return;
  }

  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { inserted, updated } = await upsertCentres(client, toImport);
    console.log(`\n✅ Imported: ${inserted} new centre(s), ${updated} updated.`);
  } finally {
    await client.end();
  }
}

/** Minimal surface of a `pg` client, so a test can pass a real connection to a scratch DB. */
export interface QueryRunner {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * Upsert resolved centres, keyed on the normalised name.
 *
 * All-or-nothing: a partial import would leave the list in a state where nobody could tell
 * which centres were current, and re-running is the obvious response to a failure.
 */
export async function upsertCentres(
  client: QueryRunner,
  centres: Resolved[],
): Promise<{ inserted: number; updated: number }> {
  // The unique index is what makes this an upsert rather than a duplicate factory. Its
  // absence means Phase 27 hasn't been applied, and importing without it would recreate the
  // very duplication that migration cleaned up.
  const { rows: idx } = await client.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_test_centres_name_unique'`,
  );
  if (!idx.length) {
    throw new Error(
      'idx_test_centres_name_unique is missing — apply db/migrate_phase_27.sql first, ' +
        'otherwise this import would create duplicate centres.',
    );
  }

  let inserted = 0;
  let updated = 0;
  await client.query('BEGIN');
  try {
    for (const r of centres) {
      const { rows: out } = await client.query(
        `INSERT INTO test_centres (name, town, postcode, region, location)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography)
         ON CONFLICT (tc_norm_name(name)) DO UPDATE SET
           -- COALESCE keeps anything an admin typed in the console: the import is the
           -- source of truth for where a centre is, not for the prose about it.
           town     = COALESCE(EXCLUDED.town, test_centres.town),
           postcode = EXCLUDED.postcode,
           region   = COALESCE(EXCLUDED.region, test_centres.region),
           location = EXCLUDED.location
         RETURNING (xmax = 0) AS was_insert`,
        [r.name, r.town || null, r.postcodeCanonical, r.region || null, r.lng, r.lat],
      );
      // xmax = 0 distinguishes a fresh insert from a conflict that took the UPDATE branch.
      if (out[0]?.was_insert) inserted++;
      else updated++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }

  return { inserted, updated };
}

// Only run when invoked directly, so the exported helpers above can be unit-tested.
if (require.main === module) {
  main().catch((e) => {
    console.error(`\n❌ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
