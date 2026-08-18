import { maskEmail } from './mask-email';

describe('maskEmail', () => {
  it('keeps the first and last character of a local part of three or more', () => {
    expect(maskEmail('rahul.sh3919@gmail.com')).toBe('r••••••••••9@gmail.com');
  });

  it('masks everything after the first character of a two-character local part', () => {
    // "keep first and last" would leave this address entirely unmasked.
    expect(maskEmail('ab@example.com')).toBe('a•@example.com');
  });

  it('masks a single-character local part completely', () => {
    expect(maskEmail('a@example.com')).toBe('•@example.com');
  });

  it('leaves the domain readable so the user can spot a typo in it', () => {
    expect(maskEmail('someone@sub.domain.co.uk')).toContain('@sub.domain.co.uk');
  });

  it('splits on the last @, which is the one that separates local part from domain', () => {
    // The local part here is the 7 characters `a"b"c@d`, so: first + 5 bullets + last.
    expect(maskEmail('a"b"c@d@example.com')).toBe('a•••••d@example.com');
  });

  it('returns anything that is not an address unchanged rather than throwing', () => {
    expect(maskEmail('not-an-address')).toBe('not-an-address');
    expect(maskEmail('@example.com')).toBe('@example.com');
    expect(maskEmail('')).toBe('');
  });
});
