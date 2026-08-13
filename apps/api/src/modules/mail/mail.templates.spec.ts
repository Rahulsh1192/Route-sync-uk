import { verifyEmailTemplate, passwordResetTemplate, escapeHtml } from './mail.templates';

const URL = 'https://testroutify.uk/verify-email?token=abc-123_XYZ';

describe('escapeHtml', () => {
  it('neutralises the characters that would end an attribute or open a tag', () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });

  it('escapes ampersands first, so an escape is not itself re-escaped', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe.each([
  ['verifyEmailTemplate', verifyEmailTemplate],
  ['passwordResetTemplate', passwordResetTemplate],
])('%s', (_name, template) => {
  it('puts the link in the HTML body', () => {
    expect(template({ displayName: 'Sam', url: URL }).html).toContain(URL);
  });

  it('puts the link in the plain-text body, unescaped and clickable', () => {
    // Some clients render only text/plain. A link that only exists in the HTML part is
    // invisible to those users, and this is the one email they must be able to action.
    expect(template({ displayName: 'Sam', url: URL }).text).toContain(URL);
  });

  it('escapes the display name, which the user chose and we do not control', () => {
    const html = template({ displayName: '<script>alert(1)</script>', url: URL }).html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('greets a user whose name contains an ampersand without corrupting it', () => {
    expect(template({ displayName: 'Ben & Co', url: URL }).html).toContain('Ben &amp; Co');
  });

  it('leaves no unsubstituted placeholders behind', () => {
    const { subject, html, text } = template({ displayName: 'Sam', url: URL });
    for (const part of [subject, html, text]) {
      expect(part).not.toMatch(/\{\{|\}\}|\$\{/);
    }
  });

  it('has a non-empty subject', () => {
    expect(template({ displayName: 'Sam', url: URL }).subject.trim().length).toBeGreaterThan(0);
  });
});

describe('the two templates are distinguishable', () => {
  const args = { displayName: 'Sam', url: URL };

  it('uses a different subject for each, so a reset is not mistaken for a signup', () => {
    expect(verifyEmailTemplate(args).subject).not.toBe(passwordResetTemplate(args).subject);
  });

  it('tells the recipient of a reset what to do if they did not ask for it', () => {
    // An unsolicited reset email is how a victim finds out someone is trying to take
    // their account. Saying nothing wastes the only warning they get.
    expect(passwordResetTemplate(args).text.toLowerCase()).toContain('ignore');
  });
});
