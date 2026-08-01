/**
 * Date/time formatting for display.
 *
 * Two kinds of value in this app, and they must be formatted differently:
 *
 *  - **Instants** (`created_at`, `paid_at`) are moments in time. Converting them to the
 *    viewer's timezone is correct — that is what the viewer means by "when".
 *  - **Wall-clock values** (a lesson's `slot_date` + `start_time`) are a date and a
 *    time-of-day with no timezone attached. A 10:00 lesson is 10:00 for the learner and
 *    the instructor standing next to each other; it is not an instant, and converting it
 *    would be a bug. Postgres returns `date`/`time` columns through Prisma as JS Dates
 *    pinned to UTC midnight / 1970-01-01, so naively calling `toLocaleString()` on them
 *    shifts a 10:00 slot to 11:00 in British Summer Time and can move the date to the
 *    previous day for anyone west of UTC.
 *
 * Everything below formats in the viewer's own locale (no hard-coded 'en-GB'), so dates
 * follow the device's regional settings.
 */

/** Pull `[y, m, d]` out of an ISO date or a `date` column serialised by Prisma. */
function datePartsOf(value: string | Date): [number, number, number] | null {
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Pull `[hh, mm]` out of `10:00:00`, `10:00`, or a `time` column as `1970-01-01T10:00:00Z`. */
function timePartsOf(value: string | Date | null | undefined): [number, number] {
  if (value == null) return [0, 0];
  const raw = value instanceof Date ? value.toISOString() : String(value);
  // Anchor to a 'T' or the start of the string so a date's `-` groups can't match.
  const m = /(?:T|^)(\d{2}):(\d{2})/.exec(raw);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/**
 * A lesson slot as the people involved would say it: "Fri 14 Aug 2026, 10:00".
 *
 * Built from the calendar parts rather than the underlying instant, so the time shown is
 * the time agreed — never shifted by the viewer's timezone.
 */
export function formatSlot(
  slotDate: string | Date | null | undefined,
  startTime?: string | Date | null,
): string {
  if (!slotDate) return '—';
  const date = datePartsOf(slotDate);
  if (!date) return String(slotDate);
  const [hh, mm] = timePartsOf(startTime);
  const [y, m, d] = date;

  // Local-component constructor: no parsing, no timezone interpretation.
  const local = new Date(y, m - 1, d, hh, mm);
  const hasTime = startTime != null;
  return local.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** Just the slot's date, for a narrow column. */
export function formatSlotDate(slotDate: string | Date | null | undefined): string {
  return formatSlot(slotDate, null);
}

/** Slot time only (`10:00`), locale-formatted, unshifted. */
export function formatSlotTime(startTime: string | Date | null | undefined): string {
  if (startTime == null) return '—';
  const [hh, mm] = timePartsOf(startTime);
  return new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A real timestamp in the viewer's timezone — use for `created_at` and friends, where
 * converting to local time is the point.
 */
export function formatInstant(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Date-only form of `formatInstant`. */
export function formatInstantDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
