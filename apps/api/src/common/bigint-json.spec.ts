/**
 * Every endpoint that returns a bigint column must be able to serialise it.
 *
 * Postgres BIGINT arrives as a JS `BigInt` — from Prisma models (`Upload.cameraClockOffsetMs`)
 * and from `$queryRaw` alike — and `JSON.stringify` throws on those rather than skipping
 * them. The result is a bare 500 from any route that touches one, which is what
 * `GET /api/uploads/:id` did: `camera_clock_offset_ms` defaults to 0, so it failed for
 * every upload ever created, regardless of the data.
 */
import { enableBigIntJson } from './bigint-json';

describe('BigInt JSON serialisation', () => {
  // Must run first: the patch is global and cannot be undone within this context.
  it('is not serialisable by default (the bug being fixed)', () => {
    expect(() => JSON.stringify({ offset: 0n })).toThrow(/BigInt/);
  });

  it('serialises as a JSON number once enabled', () => {
    enableBigIntJson();

    expect(JSON.stringify({ offset: 0n })).toBe('{"offset":0}');
    expect(JSON.stringify({ bytes: 524288000n })).toBe('{"bytes":524288000}');
    expect(JSON.stringify({ offset: -3600000n })).toBe('{"offset":-3600000}');
  });

  it('serialises an upload-status payload shaped like the real one', () => {
    enableBigIntJson();

    const payload = {
      upload: {
        id: 'ea3bf3b2-1d1c-4e18-820c-1b601688c8c0',
        status: 'uploaded',
        error: null,
        cameraClockOffsetMs: 0n,
        resolvedOffsetMs: null,
      },
      stages: [{ stage: 'probe', state: 'done', progress: 100 }],
    };

    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      upload: {
        id: 'ea3bf3b2-1d1c-4e18-820c-1b601688c8c0',
        status: 'uploaded',
        error: null,
        cameraClockOffsetMs: 0,
        resolvedOffsetMs: null,
      },
      stages: [{ stage: 'probe', state: 'done', progress: 100 }],
    });
  });

  it('falls back to a string beyond the exact-integer range rather than rounding', () => {
    enableBigIntJson();

    // Number cannot represent this exactly; emitting 9007199254740992 would be a silent
    // corruption, so it goes out as a string instead.
    const beyond = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(JSON.stringify({ n: beyond })).toBe('{"n":"9007199254740992"}');
    expect(JSON.stringify({ n: BigInt(Number.MAX_SAFE_INTEGER) })).toBe('{"n":9007199254740991}');
  });

  it('is idempotent, so calling it more than once is harmless', () => {
    enableBigIntJson();
    enableBigIntJson();

    expect(JSON.stringify({ offset: 42n })).toBe('{"offset":42}');
  });

  it('does not make toJSON show up as an enumerable property', () => {
    enableBigIntJson();

    expect(Object.keys(BigInt.prototype)).toEqual([]);
  });
});
