/**
 * Integration tests for email verification and password reset against a real database.
 *
 * Skipped unless TEST_DATABASE_URL is set, so `npm test` stays runnable without
 * infrastructure — the same convention as scripts/import-test-centres.db.spec.ts.
 * Point it at a scratch database; it writes to `users`, `email_tokens` and
 * `refresh_tokens`:
 *
 *   docker compose up -d postgres
 *   docker exec -i routing-app-postgres-1 psql -U routesync -d postgres \
 *     -c 'CREATE DATABASE phase28_test'
 *   docker exec -i routing-app-postgres-1 psql -U routesync -d phase28_test < db/bootstrap.sql
 *   docker exec -i routing-app-postgres-1 psql -U routesync -d phase28_test < db/migrate_phase_28.sql
 *
 *   cd apps/api
 *   TEST_DATABASE_URL=postgresql://routesync:routesync@localhost:5434/phase28_test npx jest db.spec
 *
 * The mail transport is a recording fake: what matters here is the token lifecycle, and
 * sending real email to a third party from a test suite would be both slow and rude. The
 * fake captures the message, and the tests pull the token out of the link exactly as a
 * user's mail client would.
 */
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../database/prisma.service';
import { MailService, OutboundMessage } from '../mail/mail.service';
import { hashEmailToken } from './email-tokens';

const DB_URL = process.env.TEST_DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

const APP_BASE_URL = 'https://app.example.uk';

class RecordingMail {
  sent: OutboundMessage[] = [];
  isConfigured() {
    return true;
  }
  async send(message: OutboundMessage) {
    this.sent.push(message);
    return { sent: true as const, id: 'test-message-id' };
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
  /** Pull the token out of the link, the way clicking it would. */
  lastToken(): string {
    const match = this.last()?.text.match(/token=([A-Za-z0-9_%-]+)/);
    if (!match) throw new Error('no token in the last email');
    return decodeURIComponent(match[1]);
  }
  reset() {
    this.sent = [];
  }
}

describeDb('email verification & password reset', () => {
  let prisma: PrismaService;
  let auth: AuthService;
  let mail: RecordingMail;

  const config = {
    get: (key: string) =>
      ({
        APP_BASE_URL,
        JWT_ACCESS_SECRET: 'test-access',
        JWT_REFRESH_SECRET: 'test-refresh',
        JWT_ACCESS_TTL: 900,
        JWT_REFRESH_TTL: 2592000,
      })[key],
  } as unknown as ConfigService;

  beforeAll(async () => {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DB_URL }),
    }) as unknown as PrismaService;
    prisma = client;
    await (prisma as unknown as PrismaClient).$connect();
  });

  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  beforeEach(async () => {
    mail = new RecordingMail();
    auth = new AuthService(prisma, new JwtService({}), config, mail as unknown as MailService);
    // Cascades to email_tokens and refresh_tokens.
    await prisma.user.deleteMany({ where: { email: { endsWith: '@phase28.test' } } });
  });

  const register = async (email = 'learner@phase28.test') => {
    await auth.register(email, 'Password123!', 'Sam Learner');
    return prisma.user.findUniqueOrThrow({ where: { email } });
  };

  describe('on registration', () => {
    it('sends a verification email to the address given', async () => {
      await register();
      expect(mail.sent).toHaveLength(1);
      expect(mail.last().to).toBe('learner@phase28.test');
    });

    it('includes a link to the web app, not the API', async () => {
      await register();
      expect(mail.last().text).toContain(`${APP_BASE_URL}/verify-email?token=`);
    });

    it('stores only the hash of the token, never the token itself', async () => {
      const user = await register();
      const token = mail.lastToken();
      const row = await prisma.emailToken.findFirstOrThrow({ where: { userId: user.id } });

      expect(row.tokenHash).toBe(hashEmailToken(token));
      expect(row.tokenHash).not.toContain(token);
    });

    it('leaves the account unverified until the link is followed', async () => {
      const user = await register();
      expect(user.emailVerified).toBe(false);
    });
  });

  describe('verifying an email', () => {
    it('marks the account verified', async () => {
      const user = await register();
      await auth.verifyEmail(mail.lastToken());

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.emailVerified).toBe(true);
    });

    it('refuses the same link a second time', async () => {
      await register();
      const token = mail.lastToken();
      await auth.verifyEmail(token);

      await expect(auth.verifyEmail(token)).rejects.toThrow(/invalid or has expired/i);
    });

    it('refuses a token that has expired', async () => {
      const user = await register();
      const token = mail.lastToken();
      await prisma.emailToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(auth.verifyEmail(token)).rejects.toThrow(/invalid or has expired/i);
    });

    it('refuses a token that was never issued', async () => {
      await expect(auth.verifyEmail('not-a-real-token-'.padEnd(43, 'x'))).rejects.toThrow(
        /invalid or has expired/i,
      );
    });

    it('spends every other outstanding verification link for that user', async () => {
      const user = await register();
      const first = mail.lastToken();
      await auth.sendVerificationEmail(user.id);
      const second = mail.lastToken();
      expect(second).not.toBe(first);

      await auth.verifyEmail(second);

      // The earlier email is still sitting in the inbox; it must no longer work.
      await expect(auth.verifyEmail(first)).rejects.toThrow(/invalid or has expired/i);
    });
  });

  describe('requesting a password reset', () => {
    it('sends a link to a registered address', async () => {
      await register();
      mail.reset();

      await auth.requestPasswordReset('learner@phase28.test');
      expect(mail.sent).toHaveLength(1);
      expect(mail.last().text).toContain(`${APP_BASE_URL}/reset-password?token=`);
    });

    it('reports success for an address that has no account, and sends nothing', async () => {
      // Enumeration safety: the caller must not be able to tell the difference.
      const result = await auth.requestPasswordReset('nobody@phase28.test');
      expect(result).toEqual({ ok: true });
      expect(mail.sent).toHaveLength(0);
    });

    it('returns an identical response for known and unknown addresses', async () => {
      await register();
      const known = await auth.requestPasswordReset('learner@phase28.test');
      const unknown = await auth.requestPasswordReset('nobody@phase28.test');
      expect(known).toEqual(unknown);
    });

    it('reports success but sends nothing for a suspended account', async () => {
      const user = await register();
      await prisma.user.update({ where: { id: user.id }, data: { isSuspended: true } });
      mail.reset();

      expect(await auth.requestPasswordReset('learner@phase28.test')).toEqual({ ok: true });
      expect(mail.sent).toHaveLength(0);
    });

    it('stops sending after five requests in an hour', async () => {
      await register();
      mail.reset();

      for (let i = 0; i < 7; i++) await auth.requestPasswordReset('learner@phase28.test');

      expect(mail.sent).toHaveLength(5);
    });
  });

  describe('completing a password reset', () => {
    const newPassword = 'BrandNewPassword456!';

    const requestReset = async () => {
      await register();
      mail.reset();
      await auth.requestPasswordReset('learner@phase28.test');
      return mail.lastToken();
    };

    it('lets the user log in with the new password', async () => {
      const token = await requestReset();
      await auth.resetPassword(token, newPassword);

      await expect(auth.login('learner@phase28.test', newPassword)).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });

    it('stops the old password working', async () => {
      const token = await requestReset();
      await auth.resetPassword(token, newPassword);

      await expect(auth.login('learner@phase28.test', 'Password123!')).rejects.toThrow(
        /invalid credentials/i,
      );
    });

    it('stores the new password hashed, not in the clear', async () => {
      const token = await requestReset();
      await auth.resetPassword(token, newPassword);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'learner@phase28.test' } });
      expect(user.passwordHash).not.toBe(newPassword);
      expect(await bcrypt.compare(newPassword, user.passwordHash!)).toBe(true);
    });

    it('revokes every existing session', async () => {
      // The reason someone resets a password is that they think somebody else has it.
      // Leaving that person's refresh token alive would defeat the whole exercise.
      const token = await requestReset();
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'learner@phase28.test' } });
      const liveBefore = await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(liveBefore).toBeGreaterThan(0);

      await auth.resetPassword(token, newPassword);

      expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
        0,
      );
    });

    it('refuses the same link a second time', async () => {
      const token = await requestReset();
      await auth.resetPassword(token, newPassword);

      await expect(auth.resetPassword(token, 'YetAnotherPass789!')).rejects.toThrow(
        /invalid or has expired/i,
      );
    });

    it('refuses a link sent to an address the account no longer uses', async () => {
      const token = await requestReset();
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'learner@phase28.test' } });
      await prisma.user.update({
        where: { id: user.id },
        data: { email: 'moved@phase28.test' },
      });

      await expect(auth.resetPassword(token, newPassword)).rejects.toThrow(/no longer valid/i);
    });

    it('marks the address verified, since redeeming the link proves inbox control', async () => {
      const token = await requestReset();
      await auth.resetPassword(token, newPassword);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'learner@phase28.test' } });
      expect(user.emailVerified).toBe(true);
    });
  });

  describe('token purposes are isolated', () => {
    it('will not accept a verification token as a password reset', async () => {
      await register();
      const verifyToken = mail.lastToken();

      await expect(auth.resetPassword(verifyToken, 'Whatever123!')).rejects.toThrow(
        /invalid or has expired/i,
      );
    });

    it('will not accept a reset token as an email verification', async () => {
      await register();
      mail.reset();
      await auth.requestPasswordReset('learner@phase28.test');
      const resetToken = mail.lastToken();

      await expect(auth.verifyEmail(resetToken)).rejects.toThrow(/invalid or has expired/i);
    });
  });
});
