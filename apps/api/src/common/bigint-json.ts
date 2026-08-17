/**
 * Teach `JSON.stringify` how to serialise a `BigInt`.
 *
 * Postgres `BIGINT` reaches the API as a JS `BigInt`, both through Prisma models
 * (`Upload.cameraClockOffsetMs`, `Upload.resolvedOffsetMs`) and through the `$queryRaw`
 * this codebase uses widely — `watch_seconds`, `amount_minor`, `t_ms`, `bytes`,
 * `upload_bytes` and more are all BIGINT. `JSON.stringify` throws on a `BigInt` rather
 * than omitting it, so a single such column turns an otherwise healthy response into a
 * bare 500. `GET /api/uploads/:id` did exactly that for every upload in existence, because
 * `camera_clock_offset_ms` is `NOT NULL DEFAULT 0` and 0n is still a `BigInt`.
 *
 * Patching the prototype rather than mapping each field deliberately: the failure mode is
 * silent until a specific route is hit, and there are too many BIGINT columns behind too
 * much raw SQL for per-field conversion to be reliable. This closes the whole class.
 */

/** Beyond this, a double can no longer represent every integer. */
const MAX_EXACT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_EXACT = -MAX_EXACT;

/**
 * Install the serialiser. Idempotent, and safe to call before the Nest app is built.
 *
 * Values inside the exact-integer range become JSON numbers, which is what the clients
 * already expect (the web types declare these as `number`). Anything beyond it becomes a
 * string instead: no bigint column here can realistically reach 2^53 — that is 285,000
 * years in milliseconds, or 9 petabytes in bytes — and if one somehow does, a visibly
 * different type is a better outcome than a quietly rounded number.
 */
export function enableBigIntJson(): void {
  if (Object.prototype.hasOwnProperty.call(BigInt.prototype, 'toJSON')) return;

  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint): number | string {
      return this >= MIN_EXACT && this <= MAX_EXACT ? Number(this) : this.toString();
    },
    writable: true,
    configurable: true,
    // Non-enumerable, so the patch never appears in `Object.keys` or a spread.
    enumerable: false,
  });
}
