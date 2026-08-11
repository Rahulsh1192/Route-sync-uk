/**
 * Integration test for the test-centre importer's database path.
 *
 * Skipped unless TEST_DATABASE_URL is set, so `npm test` stays runnable without
 * infrastructure. Point it at a scratch database — it writes to `test_centres`:
 *
 *   cd infra && docker compose up -d postgres
 *   docker compose exec -T postgres psql -U routesync -d postgres \
 *     -c 'CREATE DATABASE phase27_test'
 *   docker compose exec -T postgres psql -U routesync -d phase27_test < ../db/bootstrap.sql
 *   docker compose exec -T postgres psql -U routesync -d phase27_test < ../db/migrate_phase_27.sql
 *
 *   cd apps/api
 *   TEST_DATABASE_URL=postgresql://routesync:routesync@localhost:5434/phase27_test npx jest db.spec
 *
 * The geocoder is stubbed. postcodes.io is a third party and the property under test has
 * nothing to do with it: what matters is that importing the same list twice cannot create a
 * second copy of a centre, which is the bug this whole phase exists to fix.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import {
  parseCsv,
  findDuplicateNames,
  resolveRows,
  upsertCentres,
  normalisePostcode,
  GeocodeHit,
  Resolved,
} from './import-test-centres';

const DB_URL = process.env.TEST_DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

/** Distinct, deterministic coordinates per postcode — no network, no invented real places. */
function stubGeocode(postcodes: string[]): Map<string, GeocodeHit | null> {
  const m = new Map<string, GeocodeHit | null>();
  postcodes.forEach((pc, i) => {
    m.set(pc, {
      postcode: pc,
      latitude: 50.5 + (i % 90) * 0.1,
      longitude: -4.5 + (i % 60) * 0.1,
      // null district => townsAgree() passes, so the mismatch report stays out of the way
      // of what this test is about.
      admin_district: null,
    });
  });
  return m;
}

function loadCsvResolved(): Resolved[] {
  const csv = readFileSync(join(__dirname, '..', '..', '..', 'db', 'dvsa_test_centres.csv'), 'utf8');
  const { unique } = findDuplicateNames(parseCsv(csv).rows);
  const geo = stubGeocode(unique.map((r) => normalisePostcode(r.postcode)));
  const { resolved } = resolveRows(unique, geo);
  return resolved;
}

describeDb('importer against a real database', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  async function counts() {
    const { rows } = await client.query(
      `SELECT count(*)::int AS total,
              count(DISTINCT tc_norm_name(name))::int AS distinct_names
         FROM test_centres`,
    );
    return rows[0] as { total: number; distinct_names: number };
  }

  it('imports the full list and then re-imports it without creating duplicates', async () => {
    const resolved = loadCsvResolved();
    expect(resolved.length).toBeGreaterThan(200);

    const first = await upsertCentres(client, resolved);
    const afterFirst = await counts();
    expect(first.inserted + first.updated).toBe(resolved.length);
    expect(afterFirst.total).toBe(afterFirst.distinct_names);

    // The property the fix rests on: a second identical import inserts nothing.
    const second = await upsertCentres(client, resolved);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(resolved.length);

    const afterSecond = await counts();
    expect(afterSecond.total).toBe(afterFirst.total);
    expect(afterSecond.total).toBe(afterSecond.distinct_names);
  }, 120_000);

  it('leaves no duplicate names in the table at all', async () => {
    const { rows } = await client.query(
      `SELECT name, count(*)::int AS n FROM test_centres
        GROUP BY tc_norm_name(name), name HAVING count(*) > 1`,
    );
    expect(rows).toEqual([]);
  });

  it('stored the centre that was reported missing, with a real location', async () => {
    const { rows } = await client.query(
      `SELECT name, postcode,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
         FROM test_centres WHERE tc_norm_name(name) = 'birmingham (south yardley)'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].postcode).toBe('B25 8JS');
    expect(rows[0].lat).not.toBeNull();
  });

  it('matches a differently-cased name to the existing row rather than inserting', async () => {
    const [one] = loadCsvResolved();
    const shouted: Resolved = { ...one, name: one.name.toUpperCase() };
    const before = await counts();
    const result = await upsertCentres(client, [shouted]);
    const after = await counts();

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(after.total).toBe(before.total);
  });

  it('refuses to import when the unique index is missing', async () => {
    // Without the Phase 27 index the ON CONFLICT target does not exist, so an import would
    // recreate the duplication the migration cleaned up. It has to fail loudly instead.
    const fake = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // pg_indexes lookup finds nothing
        .mockResolvedValue({ rows: [] }),
    };
    await expect(upsertCentres(fake, loadCsvResolved().slice(0, 1))).rejects.toThrow(
      /migrate_phase_27/,
    );
    // Nothing was attempted beyond the guard query.
    expect(fake.query).toHaveBeenCalledTimes(1);
  });
});
