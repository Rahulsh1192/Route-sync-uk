/**
 * Shared phone-number validation.
 *
 * Deliberately permissive. `@IsPhoneNumber('GB')` was the alternative, but it rejects
 * numbers a user knows are correct when they're written in an unexpected format, and at
 * signup that reads as the app being broken rather than the input being wrong. A contact
 * number only has to be dialable by a human, so this checks shape — starts with a digit,
 * `+` or `(`, then digits and the usual separators — and leaves the rest to the person
 * typing it.
 *
 * Accepts: `07700 900123`, `+44 7700 900123`, `(01234) 567890`, `+353-1-234-5678`.
 * Rejects: free text, single digits, anything with letters.
 */
export const PHONE_PATTERN = /^[+(\d][\d\s()+.-]{6,24}$/;

export const PHONE_MESSAGE =
  'Enter a valid contact number, e.g. 07700 900123 or +44 7700 900123';

/**
 * Normalise for storage: collapse runs of whitespace, trim the ends.
 *
 * Punctuation is kept as typed rather than stripped to digits, because how someone writes
 * their own number is how they will recognise it when staff read it back to them. Searching
 * strips non-digits at query time instead (see the `idx_users_phone_digits` index).
 */
export function normalisePhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}
