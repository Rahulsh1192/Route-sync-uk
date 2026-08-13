/**
 * The two emails this application sends.
 *
 * Kept as pure functions returning strings — no template engine, no MJML, no React Email.
 * There are two emails, they will not be edited by a marketing team, and every dependency
 * added here is one that has to be kept current for the rest of the app's life. The HTML
 * is deliberately plain: inline styles only, a table-free single column, no web fonts and
 * no images. That is what survives Outlook, Gmail's clipping and dark mode alike.
 *
 * Every message is sent as HTML *and* plain text. Some clients render only the latter,
 * and these are the two emails a user absolutely must be able to act on.
 */

export interface TemplateArgs {
  displayName: string;
  url: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = 'Test Routify';

/**
 * Escape text for interpolation into HTML.
 *
 * The display name is chosen by the user and lands inside our markup, so it is untrusted
 * input in exactly the way a form field is. Ampersand is replaced first: doing it later
 * would rewrite the `&` of an escape produced by an earlier replacement, turning `&lt;`
 * into `&amp;lt;` and printing the escape rather than the character.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Shared shell, so the two emails cannot drift apart visually. */
function layout(opts: {
  heading: string;
  greeting: string;
  body: string;
  buttonLabel: string;
  url: string;
  footer: string;
}): string {
  const { heading, greeting, body, buttonLabel, url, footer } = opts;
  const href = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">${heading}</h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${greeting}</p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">${body}</p>
      <p style="margin:0 0 24px;">
        <a href="${href}" style="display:inline-block;background:#1a7f5a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;">${buttonLabel}</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#555;">
        If the button does not work, copy this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;color:#555;">${href}</p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#777;">${footer}</p>
    </div>
  </body>
</html>`;
}

export function verifyEmailTemplate({ displayName, url }: TemplateArgs): RenderedEmail {
  const name = escapeHtml(displayName);
  return {
    subject: `Confirm your email address`,
    html: layout({
      heading: `Confirm your email address`,
      greeting: `Hi ${name},`,
      body: `Confirm this address to finish setting up your ${BRAND} account.`,
      buttonLabel: 'Confirm email address',
      url,
      footer: `This link works for 24 hours. If you did not create a ${BRAND} account, you can ignore this email.`,
    }),
    text: [
      `Hi ${displayName},`,
      ``,
      `Confirm this address to finish setting up your ${BRAND} account:`,
      ``,
      url,
      ``,
      `This link works for 24 hours. If you did not create a ${BRAND} account, you can ignore this email.`,
    ].join('\n'),
  };
}

export function passwordResetTemplate({ displayName, url }: TemplateArgs): RenderedEmail {
  const name = escapeHtml(displayName);
  return {
    subject: `Reset your ${BRAND} password`,
    html: layout({
      heading: `Reset your password`,
      greeting: `Hi ${name},`,
      body: `Use the button below to choose a new password. For your security this link expires in one hour and can only be used once.`,
      buttonLabel: 'Choose a new password',
      url,
      footer: `If you did not ask to reset your password, ignore this email — your password will not change, and nobody can use this link without access to your inbox.`,
    }),
    text: [
      `Hi ${displayName},`,
      ``,
      `Use this link to choose a new ${BRAND} password:`,
      ``,
      url,
      ``,
      `This link expires in one hour and can only be used once.`,
      ``,
      `If you did not ask to reset your password, ignore this email — your password will not change.`,
    ].join('\n'),
  };
}
