import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Outbound transactional email, via Resend's HTTP API.
 *
 * Called through `fetch` rather than the `resend` SDK. The API is one POST with a JSON
 * body; the SDK would add a dependency, and a transitive tree, to save writing that. The
 * same reasoning already applies elsewhere in this codebase — Apple's JWKS, postcodes.io
 * and the OpenAI call are all plain `fetch`.
 *
 * **Sending never throws.** Every failure is returned as a value. A user signing up must
 * not receive a 500 because a third party is down, a domain is mid-verification, or
 * nobody has configured email yet — in each case the account is still created and the
 * user can ask for another link. Callers decide what, if anything, to tell them.
 */

export type MailResult =
  | { sent: true; id: string }
  | { sent: false; reason: 'not_configured' | 'rejected' | 'error'; detail?: string };

export interface OutboundMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Whether email can actually be sent.
   *
   * Both settings are required. A key without a from-address cannot produce a valid
   * message, and defaulting the address would mean sending from a domain that is not
   * ours — which fails SPF and trains spam filters against us.
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey() && this.from());
  }

  async send(message: OutboundMessage): Promise<MailResult> {
    const apiKey = this.apiKey();
    const from = this.from();
    if (!apiKey || !from) {
      this.logger.warn(
        `Email not configured (RESEND_API_KEY / MAIL_FROM); dropped "${message.subject}"`,
      );
      return { sent: false, reason: 'not_configured' };
    }

    let res: Response;
    try {
      res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          // Resend accepts a string or an array; always sending an array keeps one shape.
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        // Without a timeout a hung connection holds the request open until the platform
        // kills it, turning "email is slow" into "signup is broken".
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.logger.error(`Email transport failed: ${detail}`);
      return { sent: false, reason: 'error', detail };
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Logged at error because the usual causes are ours to fix — an unverified domain,
      // a revoked key, a from-address that does not match the verified domain.
      this.logger.error(`Resend rejected the message (${res.status}): ${detail}`);
      return { sent: false, reason: 'rejected', detail };
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: body.id ?? '' };
  }

  private apiKey(): string | undefined {
    return this.config.get<string>('RESEND_API_KEY')?.trim() || undefined;
  }

  private from(): string | undefined {
    return this.config.get<string>('MAIL_FROM')?.trim() || undefined;
  }
}
