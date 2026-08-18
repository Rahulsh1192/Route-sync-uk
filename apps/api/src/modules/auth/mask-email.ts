/**
 * Mask an email address for display back to the person who just typed it.
 *
 * Lives in the API rather than in each client so web, mobile and anything later show the
 * same string. The masking rule is user-visible copy, and three implementations of it would
 * drift.
 *
 * The domain is deliberately left readable. This is the user's own address being shown back
 * to them so they can confirm they typed it correctly, and the domain is the part that makes
 * a typo recognisable — "@gmial.com" is obvious, "r•••••@•••••••••" is not.
 */
const BULLET = '•';

export function maskEmail(email: string): string {
  // The LAST @ separates local part from domain: a quoted local part may legally contain one.
  const at = email.lastIndexOf('@');
  // Not an address we can reason about (no @, or nothing before it). Returned untouched
  // rather than thrown on: this runs on a response path, and failing to mask a malformed
  // string must not turn a successful signup into a 500.
  if (at <= 0) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at); // includes the '@'

  // Two short cases need their own rule: "keep the first and last character" would leave a
  // two-character local part completely unmasked.
  if (local.length === 1) return `${BULLET}${domain}`;
  if (local.length === 2) return `${local[0]}${BULLET}${domain}`;

  return `${local[0]}${BULLET.repeat(local.length - 2)}${local[local.length - 1]}${domain}`;
}
