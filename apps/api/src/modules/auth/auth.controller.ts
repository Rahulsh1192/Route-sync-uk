import { Body, Controller, Post, UseGuards, HttpCode, Ip } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshDto,
  OAuthDto,
  ForgotPasswordDto,
  EmailTokenDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Create an account and email a verification link — or, for an existing unverified account
   * whose password matches, send another link. No tokens either way: signing in is gated on
   * confirming the address.
   *
   * 202 rather than 201 because the outcome that matters to the caller is "we have sent you
   * something", and on the resend path nothing is created. Throttled because it now sends
   * mail on a path that can be repeated with the same input.
   */
  @Post('register')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.displayName, {
      phone: dto.phone,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactPhone: dto.emergencyContactPhone,
    });
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('oauth/google')
  @HttpCode(200)
  google(@Body() dto: OAuthDto) {
    return this.auth.loginWithGoogle(dto.token, dto.displayName);
  }

  @Post('oauth/apple')
  @HttpCode(200)
  apple(@Body() dto: OAuthDto) {
    return this.auth.loginWithApple(dto.token, dto.displayName);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async logout(@CurrentUser() user: AuthUser, @Body() dto: RefreshDto) {
    await this.auth.logout(user.id, dto.refreshToken);
  }

  // --- Phase 28: email verification & password reset -------------------------

  /**
   * Resend the verification email to the signed-in user's own address.
   *
   * Authenticated on purpose. An unauthenticated "send verification to this address"
   * endpoint would let anyone send mail from our domain to any address they chose.
   */
  @Post('verify-email/resend')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(@CurrentUser() user: AuthUser, @Ip() ip: string) {
    await this.auth.sendVerificationEmail(user.id, ip);
    return { ok: true };
  }

  /** Redeem a verification link. Unauthenticated: the token *is* the proof. */
  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyEmail(@Body() dto: EmailTokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  /**
   * Request a reset link.
   *
   * Always 202 with the same body, whether or not the address is registered — see
   * `AuthService.requestPasswordReset`. Throttled hard: this is the one unauthenticated
   * endpoint that causes email to be sent.
   */
  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.auth.requestPasswordReset(dto.email, ip);
  }

  /** Redeem a reset link and set the new password. */
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }
}
