import {
  parseCsv,
  normName,
  normalisePostcode,
  townsAgree,
  resolveRows,
  findDuplicateNames,
  GeocodeHit,
} from './import-test-centres';

const hit = (over: Partial<GeocodeHit> = {}): GeocodeHit => ({
  postcode: 'B25 8JS',
  latitude: 52.4626,
  longitude: -1.8259,
  admin_district: 'Birmingham',
  ...over,
});

describe('test-centre CSV parsing', () => {
  it('skips comments, blank lines and the header', () => {
    const { rows } = parseCsv(
      ['# a comment', '', 'name,postcode,town,region', 'Mill Hill,NW7 1RB,Mill Hill,London'].join(
        '\n',
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Mill Hill', postcode: 'NW7 1RB', town: 'Mill Hill' });
  });

  it('reports a row with a missing postcode instead of importing it', () => {
    // This is the shape of the two malformed rows that got into the first draft of the CSV.
    const { rows, malformed } = parseCsv('Somewhere,,,\nBarking,IG11 8AX,Barking,London');
    expect(rows.map((r) => r.name)).toEqual(['Barking']);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]).toContain('Somewhere');
  });

  it('reports a row with the wrong number of columns', () => {
    const { rows, malformed } = parseCsv('Barking,IG11 8AX,Barking');
    expect(rows).toHaveLength(0);
    expect(malformed).toHaveLength(1);
  });

  it('records the source line number so the CSV can be corrected', () => {
    const { rows } = parseCsv('# header\n\nBarking,IG11 8AX,Barking,London');
    expect(rows[0].line).toBe(3);
  });
});

describe('normalisePostcode', () => {
  it.each([
    ['nw71rb', 'NW7 1RB'],
    ['NW7  1RB', 'NW7 1RB'],
    [' b25 8js ', 'B25 8JS'],
    ['SW1A1AA', 'SW1A 1AA'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalisePostcode(input)).toBe(expected);
  });

  it('leaves an outcode alone (nothing to split)', () => {
    expect(normalisePostcode('NW7')).toBe('NW7');
  });
});

describe('normName', () => {
  it('matches the database normalisation for case and whitespace', () => {
    expect(normName('  Birmingham   (South  Yardley) ')).toBe('birmingham (south yardley)');
  });
});

describe('townsAgree', () => {
  it('accepts an exact match', () => {
    expect(townsAgree('Birmingham', 'Birmingham')).toBe(true);
  });

  it('accepts punctuation and spacing differences', () => {
    expect(townsAgree('Stoke On Trent', 'Stoke-on-Trent')).toBe(true);
    expect(townsAgree('Kings Lynn', "King's Lynn")).toBe(true);
  });

  it('accepts a locality inside its district', () => {
    expect(townsAgree('Newcastle upon Tyne', 'Newcastle')).toBe(true);
  });

  it('flags a postcode that resolves to a different city', () => {
    // The case this check exists for: a valid postcode, but in the wrong part of the country.
    expect(townsAgree('Birmingham', 'Sheffield')).toBe(false);
  });

  it('does not flag when the geocoder returned no district', () => {
    // Absence of data is not evidence of a wrong postcode.
    expect(townsAgree('Birmingham', null)).toBe(true);
  });

  it('does not flag a row with no asserted town', () => {
    expect(townsAgree('', 'Birmingham')).toBe(true);
  });

  it('does not flag on a short shared prefix alone', () => {
    // Guards the first-word fallback from matching "Ash" against "Ashford" style noise.
    expect(townsAgree('Ely', 'Elgin')).toBe(false);
  });
});

describe('resolveRows', () => {
  const row = (over: Partial<ReturnType<typeof parseCsv>['rows'][0]> = {}) => ({
    name: 'Birmingham (South Yardley)',
    postcode: 'B25 8JS',
    town: 'Birmingham',
    region: 'West Midlands',
    line: 10,
    ...over,
  });

  it('takes coordinates from the geocoder, never from the CSV', () => {
    const { resolved } = resolveRows([row()], new Map([['B25 8JS', hit()]]));
    expect(resolved).toHaveLength(1);
    expect(resolved[0].lat).toBe(52.4626);
    expect(resolved[0].lng).toBe(-1.8259);
    expect(resolved[0].mismatch).toBe(false);
  });

  it('matches the geocoder result regardless of how the CSV spelled the postcode', () => {
    const { resolved, unresolved } = resolveRows(
      [row({ postcode: 'b258js' })],
      new Map([['B25 8JS', hit()]]),
    );
    expect(unresolved).toHaveLength(0);
    expect(resolved).toHaveLength(1);
  });

  it('stores the geocoder’s canonical spelling of the postcode', () => {
    const { resolved } = resolveRows(
      [row({ postcode: 'b258js' })],
      new Map([['B25 8JS', hit({ postcode: 'B25 8JS' })]]),
    );
    expect(resolved[0].postcodeCanonical).toBe('B25 8JS');
  });

  it('treats an unresolvable postcode as unresolved rather than importing it', () => {
    const { resolved, unresolved } = resolveRows([row()], new Map([['B25 8JS', null]]));
    expect(resolved).toHaveLength(0);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].name).toBe('Birmingham (South Yardley)');
  });

  it('treats a postcode absent from the geocoder response as unresolved', () => {
    const { unresolved } = resolveRows([row()], new Map());
    expect(unresolved).toHaveLength(1);
  });

  it('flags a real postcode that belongs to a different city', () => {
    // The scenario the mismatch check exists for: S13 9BH is a valid postcode, but in
    // Sheffield — so importing it would silently move a Birmingham centre 130km away.
    const { resolved } = resolveRows(
      [row({ postcode: 'S13 9BH' })],
      new Map([['S13 9BH', hit({ postcode: 'S13 9BH', admin_district: 'Sheffield' })]]),
    );
    expect(resolved[0].mismatch).toBe(true);
  });
});

describe('findDuplicateNames', () => {
  it('keeps the first of two rows naming the same centre', () => {
    const rows = parseCsv(
      ['Barking,IG11 8AX,Barking,London', 'BARKING,E1 1AA,London,London'].join('\n'),
    ).rows;
    const { unique, dupes } = findDuplicateNames(rows);
    expect(unique).toHaveLength(1);
    expect(unique[0].postcode).toBe('IG11 8AX');
    expect(dupes[0]).toContain('lines 1 and 2');
  });

  it('leaves genuinely distinct centres alone', () => {
    const rows = parseCsv(
      [
        'Birmingham (Kings Heath),B14 7NT,Birmingham,West Midlands',
        'Birmingham (South Yardley),B25 8JS,Birmingham,West Midlands',
      ].join('\n'),
    ).rows;
    expect(findDuplicateNames(rows).unique).toHaveLength(2);
  });
});

describe('the shipped CSV', () => {
  // Guards the data file itself: the first draft of it contained a stray non-ASCII line and
  // a row with no postcode, both of which parse as malformed.
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const text = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'db', 'dvsa_test_centres.csv'),
    'utf8',
  );

  it('has no malformed rows', () => {
    expect(parseCsv(text).malformed).toEqual([]);
  });

  it('has no duplicate centre names', () => {
    expect(findDuplicateNames(parseCsv(text).rows).dupes).toEqual([]);
  });

  it('includes the centre reported missing in testing', () => {
    const names = parseCsv(text).rows.map((r) => r.name);
    expect(names).toContain('Birmingham (South Yardley)');
  });

  it('every postcode is syntactically a UK postcode', () => {
    // Cannot check they are *real* without the geocoder, but a typo in the shape of the
    // postcode is worth catching before a network round-trip.
    const bad = parseCsv(text)
      .rows.filter((r) => !/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(normalisePostcode(r.postcode)))
      .map((r) => `${r.name}: ${r.postcode}`);
    expect(bad).toEqual([]);
  });
});
