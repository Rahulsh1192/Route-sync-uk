import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuthProvider } from '@prisma/client';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly google?: OAuth2Client;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {
    const googleClientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (googleClientId) this.google = new OAuth2Client(googleClientId);
  }

  async register(email: string, password: string, displayName: string): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        identities: { create: { provider: AuthProvider.email, providerUid: email } },
        subscriptions: { create: {} }, // free plan by default
      },
    });
    return this.issueTokens(user.id, user.role, user.email ?? undefined);
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    if (user.isSuspended) throw new UnauthorizedException('Account suspended');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    // Phase 17: ADIs are limited to one active session at a time.
    // Revoke ALL prior refresh tokens so any other device is immediately invalidated.
    if (user.role === 'instructor') {
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.log(`Single-session: revoked all prior sessions for instructor ${user.id}`);
    }

    return this.issueTokens(user.id, user.role, user.email ?? undefined);
  }

  /** Verify a Google id_token, upsert the user, issue our own tokens. */
  async loginWithGoogle(idToken: string): Promise<TokenPair> {
    if (!this.google) throw new UnauthorizedException('Google login not configured');
    const ticket = await this.google.verifyIdToken({
      idToken,
      audience: this.config.get<string>('GOOGLE_CLIENT_ID'),
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new UnauthorizedException('Invalid Google token');
    return this.upsertOAuthUser(AuthProvider.google, payload.sub, payload.email, payload.name);
  }

  /**
   * Apple Sign-in: verify identity_token against Apple's JWKS.
   * TODO: fetch Apple public keys (https://appleid.apple.com/auth/keys), verify RS256
   * signature + audience (APPLE_CLIENT_ID) + issuer. Stubbed contract for now.
   */
  async loginWithApple(_identityToken: string): Promise<TokenPair> {
    throw new UnauthorizedException('Apple login verification not yet implemented');
  }

  private async upsertOAuthUser(
    provider: AuthProvider,
    providerUid: string,
    email?: string | null,
    name?: string | null,
  ): Promise<TokenPair> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUid: { provider, providerUid } },
      include: { user: true },
    });

    let user = identity?.user;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: email ?? undefined,
          emailVerified: !!email,
          displayName: name ?? email?.split('@')[0] ?? 'Test Routify user',
          identities: { create: { provider, providerUid } },
          subscriptions: { create: {} },
        },
      });
    }
    return this.issueTokens(user.id, user.role, user.email ?? undefined);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const hash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { userId: payload.sub, tokenHash: hash, revokedAt: null },
    });
    if (!stored || stored.expiresAt < new Date()) {
      // Phase 17: distinguish session-invalidated (another device logged in)
      // from a genuinely expired token so clients can show a helpful message.
      const exists = await this.prisma.refreshToken.findFirst({
        where: { userId: payload.sub, tokenHash: hash },
      });
      if (exists?.revokedAt) {
        throw new UnauthorizedException('SESSION_INVALIDATED');
      }
      throw new UnauthorizedException('Refresh token expired or revoked');
    }

    // rotate: revoke the old, issue a new pair
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    return this.issueTokens(user.id, user.role, user.email ?? undefined);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const hash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, role: string, email?: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role, email },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<number>('JWT_ACCESS_TTL'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<number>('JWT_REFRESH_TTL'),
      },
    );

    const ttl = this.config.get<number>('JWT_REFRESH_TTL')!;
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
